// src/routes/training.routes.ts
import { Router } from "express";
import { TrainingController } from "../controllers/training.controller";

const router = Router();
const trainingController = new TrainingController();

router.post("/websites", trainingController.processWebsites);
router.post("/pdfs", trainingController.processPDFs);
router.get("/documents", trainingController.getDocuments);

export default router;
