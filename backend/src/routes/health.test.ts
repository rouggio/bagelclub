import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";

describe("health", () => {
  it("GET /health returns ok without DB", async () => {
    const savedDb = process.env.DATABASE_URL;
    const savedEnv = process.env.NODE_ENV;
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = "test";
    try {
      const app = await buildApp();
      try {
        const res = await app.inject({ method: "GET", url: "/health" });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ status: "ok" });
        const api = await app.inject({ method: "GET", url: "/api/health" });
        expect(api.statusCode).toBe(200);
        expect(api.json()).toMatchObject({ status: "ok" });
      } finally {
        await app.close();
      }
    } finally {
      if (savedDb !== undefined) process.env.DATABASE_URL = savedDb;
      if (savedEnv !== undefined) process.env.NODE_ENV = savedEnv;
    }
  });

  it("unknown /api route returns 404 JSON", async () => {
    const savedDb = process.env.DATABASE_URL;
    const savedEnv = process.env.NODE_ENV;
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = "test";
    try {
      const app = await buildApp();
      try {
        const res = await app.inject({ method: "GET", url: "/api/nope" });
        expect(res.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    } finally {
      if (savedDb !== undefined) process.env.DATABASE_URL = savedDb;
      if (savedEnv !== undefined) process.env.NODE_ENV = savedEnv;
    }
  });
});
