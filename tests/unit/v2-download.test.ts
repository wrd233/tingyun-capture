import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, expect, test } from "vitest";
import { normalizeDownload } from "../../src/capture/download-normalizer";

let root = "";
beforeEach(async () => { root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ty-capture-download-")); });
afterEach(async () => { await fs.promises.rm(root, { recursive: true, force: true }); });

test("normalizes every XLSX sheet to deterministic CSV while retaining Raw hash facts", async () => {
  const source = path.join(root, "evidence.xlsx");
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Trace Data").addRows([["actionId", "name"], [7788, "Trace"]]);
  workbook.addWorksheet("Result").addRows([["code"], [-1]]);
  await workbook.xlsx.writeFile(source);

  const first = await normalizeDownload({ download_id: "download-1", source_path: source, output_dir: path.join(root, "normalized") });
  const second = await normalizeDownload({ download_id: "download-1", source_path: source, output_dir: path.join(root, "normalized-2") });

  expect(first.status).toBe("NORMALIZED");
  expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(first.sheets.map((sheet) => sheet.sheet_name)).toEqual(["Result", "Trace Data"]);
  expect(first.sheets.map((sheet) => sheet.csv_filename)).toEqual(second.sheets.map((sheet) => sheet.csv_filename));
  expect(first.sheets.find((sheet) => sheet.sheet_name === "Trace Data")).toMatchObject({ row_count: 2, column_count: 2 });
});

test("normalizes CSV and reports unsupported formats without pretending success", async () => {
  const csv = path.join(root, "data.csv");
  await fs.promises.writeFile(csv, "id,name\n1,A\n");
  const normalized = await normalizeDownload({ download_id: "download-2", source_path: csv, output_dir: path.join(root, "csv") });
  const unsupported = await normalizeDownload({ download_id: "download-3", source_path: path.join(root, "data.bin"), output_dir: path.join(root, "bin") });
  expect(normalized.status).toBe("NORMALIZED");
  expect(normalized.sheets[0]).toMatchObject({ row_count: 2, column_count: 2 });
  expect(unsupported.status).toBe("UNSUPPORTED_FORMAT");
});
