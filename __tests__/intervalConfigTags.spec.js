const { packetDecode, mapping } = require("../index.js");

/**
 * NanoDAq interval configuration by downlink (MF-196 / MF-286), added in v0.25.0.
 *
 * After a configuration downlink, accepted or refused, the firmware echoes the values
 * in force in its next plain uplink (fPort 2): SendInterval (203) and SampleInterval
 * (204), 4 B uint, seconds, big-endian, right after the battery level fields. The
 * batch frame (fPort 3) carries no echo.
 *
 * The command itself (SendInterval_Set 201 and SampleInterval_Set 202) only travels in
 * the downlink, which this library does not decode: those two IDs are not in the table.
 *
 * Before v0.25.0 the echo stopped the decoding at ID 203 ("unknown ID" in
 * errors2sense) and every field after it was lost.
 */

function hexN(v, n) {
  return ("0000000000000000" + (v >>> 0).toString(16)).slice(-2 * n);
}
function f32(v) {
  const x = Buffer.alloc(4);
  x.writeFloatBE(v);
  return x.toString("hex");
}
function chirpstack(hex, fPort) {
  return Buffer.from(JSON.stringify({ fPort, data: Buffer.from(hex, "hex").toString("base64") }));
}
const BAT = "0003" + f32(3.6);
const tag = (id, v, n) => hexN(id, 2) + hexN(v, n);

describe("mapping - interval configuration tags", () => {
  const expected = { SendInterval: 203, SampleInterval: 204 };
  for (const [name, id] of Object.entries(expected)) {
    it(`${name} => id ${id}, 4 bytes, uint`, () => {
      expect(mapping[name].slice(0, 2)).toEqual([id, 4]);
      expect(mapping[name][3]).toBe("uint");
    });
  }
  it("each id 203-204 has exactly one owner", () => {
    for (let id = 203; id <= 204; id++) {
      expect(Object.keys(mapping).filter((k) => mapping[k][0] === id)).toHaveLength(1);
    }
  });
});

describe("plain frame with the echo of the intervals", () => {
  it("battery + battery level + echo: 300 s send, 60 s reading", () => {
    const out = packetDecode(BAT + tag(191, 87, 1) + tag(203, 300, 4) + tag(204, 60, 4));
    expect(out.errors2sense).toBeUndefined();
    expect(out.json2sense).toEqual({
      BatteryMon: "3.6000", BatteryLevel: "87", SendInterval: "300", SampleInterval: "60",
    });
  });

  it("the largest interval (86400 s) keeps its four bytes", () => {
    const out = packetDecode(tag(203, 86400, 4) + tag(204, 86400, 4));
    expect(out.json2sense).toEqual({ SendInterval: "86400", SampleInterval: "86400" });
  });

  it("ChirpStack JSON on fPort 2, the field after the echo is still decoded", () => {
    const out = packetDecode(chirpstack(BAT + tag(203, 300, 4) + tag(204, 60, 4) + "0027" + f32(25), 2));
    expect(out.fPort).toBe(2);
    expect(out.errors2sense).toBeUndefined();
    expect(out.json2sense).toEqual({
      BatteryMon: "3.6000", SendInterval: "300", SampleInterval: "60", Exttemp1: "25.0000",
    });
  });

  it("an echo cut in the middle is reported, the fields before it are kept", () => {
    const out = packetDecode(BAT + "00cb0000");
    expect(out.json2sense).toEqual({ BatteryMon: "3.6000" });
    expect(out.errors2sense).toEqual(["truncated field SendInterval (ID 203) @byte 6: 2 byte(s) missing"]);
  });
});
