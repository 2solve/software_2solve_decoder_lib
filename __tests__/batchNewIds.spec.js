const { packetDecode } = require("../index.js");

/**
 * NanoDAq batch frame (fPort 3) with the IDs 191-200, checked in v0.26.0.
 *
 * BatteryLevel (191), BatteryTxDropMv (192), IO_ext_board_DIn_Changes (193-196) and
 * IO_ext_board_DIn_Overflow (197-200) are native uint values in the batch (none is
 * compact), both as single values and in the ID list of the records.
 *
 * An ID still unknown to this decoder stops the batch where it is: in the single
 * values, what came before it stays in json2sense; in the ID list, no record is read
 * and json2sense keeps only the single values. Both report it in batch2sense.errors.
 * A new ID in the firmware therefore needs a new decoder on the gateway first.
 */

function hexN(v, n) {
  return ("0000000000000000" + (v >>> 0).toString(16)).slice(-2 * n);
}
function f32(v) {
  const x = Buffer.alloc(4);
  x.writeFloatBE(v);
  return x.toString("hex");
}
function chirpstack(hex) {
  return Buffer.from(JSON.stringify({ fPort: 3, data: Buffer.from(hex, "hex").toString("base64") }));
}
function header(interval, age) {
  return "01" + hexN(interval, 3) + hexN(age, 2);
}
const BAT = "0003" + f32(3.6);
const tag = (id, v, n) => hexN(id, 2) + hexN(v, n);

// id: [key, bytes]
const NEW_IDS = [
  [191, "BatteryLevel", 1],
  [192, "BatteryTxDropMv", 2],
  [193, "IO_ext_board_DI1_Changes", 1],
  [194, "IO_ext_board_DI2_Changes", 1],
  [195, "IO_ext_board_DI3_Changes", 1],
  [196, "IO_ext_board_DI4_Changes", 1],
  [197, "IO_ext_board_DI1_Overflow", 2],
  [198, "IO_ext_board_DI2_Overflow", 2],
  [199, "IO_ext_board_DI3_Overflow", 2],
  [200, "IO_ext_board_DI4_Overflow", 2],
];

describe("batch frame (fPort 3) - IDs 191 to 200 as single values", () => {
  it("every key decoded with its name and value", () => {
    const values = [87, 412, 1, 2, 3, 255, 1, 2, 3, 65535];
    let uniques = BAT;
    NEW_IDS.forEach(([id, , bytes], k) => (uniques += tag(id, values[k], bytes)));
    const frame = header(60, 5) + hexN(11, 1) + uniques + "01" + "0027" + hexN(250, 2);

    const out = packetDecode(chirpstack(frame));

    expect(out.batch2sense.errors).toEqual([]);
    expect(out.json2sense).toEqual({
      BatteryMon: "3.6000",
      BatteryLevel: "87",
      BatteryTxDropMv: "412",
      IO_ext_board_DI1_Changes: "1",
      IO_ext_board_DI2_Changes: "2",
      IO_ext_board_DI3_Changes: "3",
      IO_ext_board_DI4_Changes: "255",
      IO_ext_board_DI1_Overflow: "1",
      IO_ext_board_DI2_Overflow: "2",
      IO_ext_board_DI3_Overflow: "3",
      IO_ext_board_DI4_Overflow: "65535",
      Exttemp1: "25.0000",
    });
    expect(out.batch2sense.readings).toEqual([{ offset_s: -5, Exttemp1: "25.0000" }]);
  });
});

describe("batch frame (fPort 3) - IDs 191 to 200 in the ID list", () => {
  it("three records: name, value and offset_s of each reading", () => {
    const records = [
      [90, 300, 0, 1, 2, 3, 0, 0, 0, 0],
      [89, 310, 4, 5, 6, 7, 1, 1, 1, 1],
      [255, 65535, 255, 254, 253, 252, 65535, 65534, 2, 3],
    ];
    let ids = "";
    for (const [id] of NEW_IDS) ids += hexN(id, 2);
    let regs = "";
    for (const rec of records) {
      NEW_IDS.forEach(([, , bytes], k) => (regs += hexN(rec[k], bytes)));
    }
    const frame = header(60, 5) + "01" + BAT + hexN(NEW_IDS.length, 1) + ids + regs;

    const out = packetDecode(chirpstack(frame));

    const offsets = [-125, -65, -5];
    const expected = records.map((rec, r) => {
      const reading = { offset_s: offsets[r] };
      NEW_IDS.forEach(([, key], k) => (reading[key] = String(rec[k])));
      return reading;
    });
    expect(out.batch2sense).toEqual({ interval_s: 60, age_s: 5, readings: expected, errors: [] });

    const newest = { ...expected[2] };
    delete newest.offset_s;
    expect(out.json2sense).toEqual({ BatteryMon: "3.6000", ...newest });
  });
});

describe("batch frame (fPort 3) - unknown ID between two known IDs", () => {
  it("in the single values: what came before stays, the error is reported", () => {
    const frame = header(60, 0) + "03" + BAT + tag(191, 87, 1) + tag(201, 0, 2) + tag(192, 412, 2) +
      "01" + "0027" + hexN(250, 2);

    const out = packetDecode(chirpstack(frame));

    expect(out.json2sense).toEqual({ BatteryMon: "3.6000", BatteryLevel: "87" });
    expect(out.batch2sense.readings).toEqual([]);
    expect(out.batch2sense.errors).toEqual(["unknown ID 201 in unique values @byte 16"]);
  });

  it("in the ID list: no reading, only the single values, the error is reported", () => {
    const frame = header(60, 0) + "01" + BAT + "03" + hexN(191, 2) + hexN(201, 2) + hexN(192, 2) +
      hexN(87, 1) + "0000" + hexN(412, 2);

    const out = packetDecode(chirpstack(frame));

    expect(out.json2sense).toEqual({ BatteryMon: "3.6000" });
    expect(out.batch2sense.readings).toEqual([]);
    expect(out.batch2sense.errors).toEqual(["unknown ID 201 in ID list @byte 16"]);
  });
});
