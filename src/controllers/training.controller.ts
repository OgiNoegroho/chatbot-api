// src/controllers/training.controller.ts
import { Request, Response } from "express";
import { TrainingDataManager } from "../services/training-data-manager";

export class TrainingController {
  private trainingManager: TrainingDataManager;

  constructor() {
    this.trainingManager = new TrainingDataManager();
  }

  processWebsites = async (req: Request, res: Response): Promise<void> => {
    try {
      const { urls } = req.body;
      if (!Array.isArray(urls)) {
        res.status(400).json({ error: "URLs must be provided as an array" });
        return;
      }

      const documents = await this.trainingManager.processWebsites(urls);
      res.json({ success: true, documents });
    } catch (error) {
      console.error("Failed to process websites:", error);
      res.status(500).json({ error: "Failed to process websites" });
    }
  };

  processPDFs = async (req: Request, res: Response): Promise<void> => {
    try {
      const { paths } = req.body;
      if (!Array.isArray(paths)) {
        res
          .status(400)
          .json({ error: "PDF paths must be provided as an array" });
        return;
      }

      const documents = await this.trainingManager.processPDFs(paths);
      res.json({ success: true, documents });
    } catch (error) {
      console.error("Failed to process PDFs:", error);
      res.status(500).json({ error: "Failed to process PDFs" });
    }
  };

  getDocuments = async (req: Request, res: Response): Promise<void> => {
    try {
      const documents = await this.trainingManager.getTrainingDocuments();
      res.json({ documents });
    } catch (error) {
      console.error("Failed to get training documents:", error);
      res.status(500).json({ error: "Failed to get training documents" });
    }
  };
}
