import * as fs from "fs";
import * as path from "path";
import pdfParse from "pdf-parse";
import { v4 as uuidv4 } from "uuid";
import NodeCache from "node-cache";

export interface PDFDocument {
  id: string;
  name: string;
  path: string;
  content: string;
  chunks: PDFChunk[];
  metadata: {
    pageCount: number;
    createdAt: Date;
    fileSize: number;
  };
}

export interface PDFChunk {
  id: string;
  documentId: string;
  content: string;
  metadata: {
    pageNumber?: number;
    section?: string;
    type?: string;
    startIndex?: number;
  };
}

export class PDFService {
  private pdfCache: NodeCache;
  private pdfStoragePath: string;
  private documents: Map<string, PDFDocument>;

  constructor() {
    this.pdfCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
    this.pdfStoragePath = path.join(process.cwd(), "uploads", "pdfs");
    this.documents = new Map<string, PDFDocument>();

    // Ensure the upload directory exists
    if (!fs.existsSync(this.pdfStoragePath)) {
      fs.mkdirSync(this.pdfStoragePath, { recursive: true });
    }

    // Load any existing PDFs from the storage directory
    this.loadExistingPDFs();
  }

  private async loadExistingPDFs(): Promise<void> {
    try {
      if (!fs.existsSync(this.pdfStoragePath)) return;

      const files = fs.readdirSync(this.pdfStoragePath);
      for (const file of files) {
        if (file.endsWith(".pdf")) {
          const filePath = path.join(this.pdfStoragePath, file);
          const stats = fs.statSync(filePath);

          if (stats.isFile()) {
            try {
              // Process the PDF but don't store in cache yet
              const documentId = path.basename(file, ".pdf");
              await this.processPDF(filePath, documentId, file);
            } catch (error) {
              console.error(`Error loading PDF ${file}:`, error);
            }
          }
        }
      }
      console.log(`Loaded ${this.documents.size} PDFs from storage`);
    } catch (error) {
      console.error("Error loading existing PDFs:", error);
    }
  }

  /**
   * Process and store a new PDF
   */
  public async processPDF(
    filePath: string,
    documentId: string = uuidv4(),
    originalName: string = ""
  ): Promise<string> {
    try {
      // Read the PDF file
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);

      // Extract text content
      const pdfText = pdfData.text;

      // Create chunks from the PDF content
      const chunks = this.createChunks(pdfText, documentId);

      // Store document metadata
      const document: PDFDocument = {
        id: documentId,
        name: originalName || path.basename(filePath),
        path: filePath,
        content: pdfText,
        chunks: chunks,
        metadata: {
          pageCount: pdfData.numpages,
          createdAt: new Date(),
          fileSize: dataBuffer.length,
        },
      };

      // Store in our documents map
      this.documents.set(documentId, document);

      // Store in cache for quick access
      this.pdfCache.set(`pdf_${documentId}`, pdfText);

      console.log(
        `Processed PDF ${document.name} with ${chunks.length} chunks`
      );

      return documentId;
    } catch (error) {
      console.error("Error processing PDF:", error);
      throw new Error("Failed to process PDF");
    }
  }

  /**
   * Upload a new PDF file
   */
  public async uploadPDF(
    tempFilePath: string,
    originalName: string
  ): Promise<string> {
    try {
      const documentId = uuidv4();
      const fileName = `${documentId}.pdf`;
      const destinationPath = path.join(this.pdfStoragePath, fileName);

      // Copy the file to our storage location
      fs.copyFileSync(tempFilePath, destinationPath);

      // Process the PDF
      await this.processPDF(destinationPath, documentId, originalName);

      // Remove the temporary file
      fs.unlinkSync(tempFilePath);

      return documentId;
    } catch (error) {
      console.error("Error uploading PDF:", error);
      throw new Error("Failed to upload PDF");
    }
  }

  /**
   * Create chunks from PDF text
   */
  private createChunks(text: string, documentId: string): PDFChunk[] {
    console.log(
      `Creating chunks for document ${documentId}, text length: ${text.length}`
    );

    // Split by paragraphs (multiple newlines)
    const paragraphs = text.split(/\n{2,}/);

    // Filter out empty paragraphs and create chunks
    const chunks = paragraphs
      .filter((paragraph) => paragraph.trim().length > 30) // Only keep substantial paragraphs
      .map((paragraph) => ({
        id: uuidv4(),
        documentId,
        content: paragraph.trim(),
        metadata: {},
      }));

    console.log(`Created ${chunks.length} paragraph chunks`);

    // Also create additional chunks by splitting on section headers
    // This helps capture important sections like "Tugas Pokok dan Fungsi"
    const sectionHeaders = [
      {
        pattern: /tugas\s+pokok\s+dan\s+fungsi/i,
        name: "Tugas Pokok dan Fungsi",
      },
      { pattern: /visi\s+dan\s+misi/i, name: "Visi dan Misi" },
      { pattern: /struktur\s+organisasi/i, name: "Struktur Organisasi" },
      { pattern: /layanan/i, name: "Layanan" },
      { pattern: /profil/i, name: "Profil" },
      { pattern: /dpmptsp/i, name: "DPMPTSP" },
    ];

    const additionalChunks: PDFChunk[] = [];
    for (const header of sectionHeaders) {
      const matches = [
        ...text.matchAll(new RegExp(header.pattern.source, "gi")),
      ];

      for (const match of matches) {
        if (match.index !== undefined) {
          const startIndex = match.index;
          // Extract a larger chunk around the section (800 characters)
          // Also look backwards to capture any preceding context
          const contextStart = Math.max(0, startIndex - 100);
          const sectionText = text.substring(contextStart, startIndex + 700);

          if (sectionText.trim().length > 50) {
            console.log(
              `Found section "${header.name}" at index ${startIndex}`
            );
            additionalChunks.push({
              id: uuidv4(),
              documentId,
              content: sectionText.trim(),
              metadata: { section: header.name },
            });
          }
        }
      }
    }

    console.log(`Created ${additionalChunks.length} section-based chunks`);

    // Create overlapping chunks for better context preservation
    const overlappingChunks: PDFChunk[] = [];
    const chunkSize = 400;
    const overlapSize = 100;

    for (let i = 0; i < text.length; i += chunkSize - overlapSize) {
      const chunkText = text.substring(i, i + chunkSize);
      if (chunkText.trim().length > 100) {
        overlappingChunks.push({
          id: uuidv4(),
          documentId,
          content: chunkText.trim(),
          metadata: { type: "overlapping", startIndex: i },
        });
      }
    }

    console.log(`Created ${overlappingChunks.length} overlapping chunks`);

    const allChunks = [...chunks, ...additionalChunks, ...overlappingChunks];
    console.log(`Total chunks created: ${allChunks.length}`);

    return allChunks;
  }

  /**
   * Get all chunks for a document
   */
  public getDocumentChunks(documentId: string): PDFChunk[] {
    const document = this.documents.get(documentId);
    if (!document) {
      throw new Error(`Document with ID ${documentId} not found`);
    }
    return document.chunks;
  }

  /**
   * Get all documents
   */
  public getAllDocuments(): PDFDocument[] {
    return Array.from(this.documents.values());
  }

  /**
   * Get a document by ID
   */
  public getDocument(documentId: string): PDFDocument | undefined {
    return this.documents.get(documentId);
  }

  /**
   * Delete a document
   */
  public deleteDocument(documentId: string): boolean {
    const document = this.documents.get(documentId);
    if (!document) {
      return false;
    }

    // Remove from cache
    this.pdfCache.del(`pdf_${documentId}`);

    // Remove from documents map
    this.documents.delete(documentId);

    // Delete the file if it exists
    try {
      if (fs.existsSync(document.path)) {
        fs.unlinkSync(document.path);
      }
    } catch (error) {
      console.error(`Error deleting PDF file ${document.path}:`, error);
    }

    return true;
  }

  /**
   * Simple text search in PDF documents
   */
  public searchInDocuments(
    query: string,
    documentIds?: string[]
  ): { chunks: PDFChunk[]; documentIds: string[] } {
    const docsToSearch = documentIds
      ? (documentIds
          .map((id) => this.documents.get(id))
          .filter(Boolean) as PDFDocument[])
      : Array.from(this.documents.values());

    if (docsToSearch.length === 0) {
      return { chunks: [], documentIds: [] };
    }

    const results: PDFChunk[] = [];
    const matchedDocIds = new Set<string>();

    // Improved keyword search for Indonesian language
    // Reduced minimum term length to 2 to include important words like "dan", "apa"
    const queryTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length >= 2);

    // Add specific Indonesian keywords that should be prioritized
    const importantKeywords = [
      "tugas",
      "pokok",
      "fungsi",
      "dpmptsp",
      "dpmtpsp",
      "layanan",
      "perizinan",
      "investasi",
      "visi",
      "misi",
    ];

    console.log(`Text search query: "${query}"`);
    console.log(`Search terms: [${queryTerms.join(", ")}]`);

    for (const doc of docsToSearch) {
      let docHasMatch = false;
      const docChunks: { chunk: PDFChunk; score: number }[] = [];

      for (const chunk of doc.chunks) {
        const chunkText = chunk.content.toLowerCase();
        let score = 0;

        // Check for exact phrase matches first (higher score)
        if (chunkText.includes("tugas pokok dan fungsi")) {
          score += 10;
        }
        if (chunkText.includes("dpmptsp") || chunkText.includes("dpmtpsp")) {
          score += 5;
        }

        // Check for individual term matches
        for (const term of queryTerms) {
          if (chunkText.includes(term)) {
            // Give higher score to important keywords
            if (importantKeywords.includes(term)) {
              score += 3;
            } else {
              score += 1;
            }
          }
        }

        // If chunk has any matches, add it with its score
        if (score > 0) {
          docChunks.push({ chunk, score });
          docHasMatch = true;
        }
      }

      if (docHasMatch) {
        // Sort chunks by score (highest first) and add to results
        docChunks.sort((a, b) => b.score - a.score);
        results.push(...docChunks.map((item) => item.chunk));
        matchedDocIds.add(doc.id);
      }
    }

    console.log(`Text search found ${results.length} matching chunks`);

    return {
      chunks: results,
      documentIds: Array.from(matchedDocIds),
    };
  }
}
