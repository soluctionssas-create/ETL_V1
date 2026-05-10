import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

function rootPath(...segments: string[]) {
  return path.join(process.cwd(), "..", "..", "..", ...segments);
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function GET() {
  const retefuente = await readJsonFile(rootPath("data", "retefuente_2026.json"), {
    uvt_value_cop: 52374,
    default_rule: {
      concept: "Compras generales declarantes",
      base_uvt: 10,
      base_cop: 523740,
      rate: 0.025,
      account_code: "236540",
      keywords: [],
    },
    rules: [],
  });

  const reteica = await readJsonFile(rootPath("data", "reteica_ciudades.json"), {
    account_code: "23680101",
    cities: {
      CALI: {
        service: {
          account_code: "23680102",
          base_uvt: 3,
          base_cop: 157122,
          rate: 0.01,
          keywords: ["servicio"],
        },
        purchase: {
          account_code: "23680101",
          base_uvt: 15,
          base_cop: 785610,
          rate: 0.0077,
          keywords: ["compra"],
        },
      },
    },
  });

  const reteiva = await readJsonFile(rootPath("data", "reteiva_config.json"), {
    account_code: "236701",
    fallback_rate: 0.15,
    legal_reference: "Art. 437-1 ET / Decreto 380/1996",
    apply_when: {
      missing_or_zero_reteiva: true,
      iva_greater_than_zero: true,
    },
  });

  return NextResponse.json({
    retefuente,
    reteica,
    reteiva,
    source: "project-data",
  });
}
