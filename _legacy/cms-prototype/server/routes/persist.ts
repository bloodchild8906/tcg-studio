import { RequestHandler } from "express";
import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

// Mock database for db:<key> storage
const mockDb = new Map<string, any>();

export const handlePersist: RequestHandler = async (req, res) => {
  const { method } = req;
  const target = (method === "GET" ? req.query.target : req.body.storageTarget) as string;

  if (!target) {
    return res.status(400).json({ error: "Storage target is required" });
  }

  const [type, name] = target.split(":");
  
  if (!type || !name) {
    return res.status(400).json({ error: "Invalid storage target format. Expected type:name" });
  }

  try {
    if (method === "GET") {
      if (type === "file") {
        const filePath = path.join(DATA_DIR, `${name}.json`);
        try {
          const content = await fs.readFile(filePath, "utf-8");
          return res.json(JSON.parse(content));
        } catch (error) {
          return res.status(404).json({ error: "File not found" });
        }
      } else if (type === "db") {
        const data = mockDb.get(name);
        if (data) return res.json(data);
        return res.status(404).json({ error: "Record not found" });
      }
    } else if (method === "POST") {
      const data = req.body.data;
      if (type === "file") {
        const filePath = path.join(DATA_DIR, `${name}.json`);
        await fs.writeFile(filePath, JSON.stringify(data, null, 2));
        return res.json({ success: true });
      } else if (type === "db") {
        mockDb.set(name, data);
        return res.json({ success: true });
      }
    }

    return res.status(400).json({ error: "Unsupported storage type or method" });
  } catch (error: any) {
    console.error("Persistence error:", error);
    return res.status(500).json({ error: error.message });
  }
};
