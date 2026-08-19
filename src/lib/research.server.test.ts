import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderPdf, uploadPdfToDrive, appendLogRow } from "./research.server";

// Mock Supabase admin client since we don't want to make real API requests during testing
const mockListBuckets = vi.fn();
const mockCreateBucket = vi.fn();
const mockUpload = vi.fn();
const mockGetPublicUrl = vi.fn();
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockUpsert = vi.fn();

vi.mock("@/integrations/supabase/client.server", () => {
  return {
    supabaseAdmin: {
      storage: {
        listBuckets: () => mockListBuckets(),
        createBucket: (name: string, options: any) => mockCreateBucket(name, options),
        from: (bucket: string) => ({
          upload: (path: string, bytes: any, options: any) => mockUpload(path, bytes, options),
          getPublicUrl: (path: string) => mockGetPublicUrl(path),
        }),
      },
      from: (table: string) => ({
        insert: (data: any) => mockInsert(data),
        select: (columns: string) => ({
          eq: (column: string, value: any) => ({
            maybeSingle: () => mockSelect(table, columns, column, value),
          }),
        }),
        upsert: (data: any, options: any) => mockUpsert(data, options),
      }),
    },
  };
});

describe("research server outputs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSelect.mockResolvedValue({ data: null, error: null });
  });

  describe("renderPdf", () => {
    it("should successfully generate PDF bytes from HTML report", async () => {
      const html = `
        <h1>Deep Dive into Solar Mini-Grids</h1>
        <p>Prepared forHanane</p>
        <h2>1. Executive Summary</h2>
        <p>This report details the deployment parameters for mini-grids in rural regions.</p>
        <ul>
          <li>High uptime (>90%)</li>
          <li>Cold-chain compatibility</li>
        </ul>
        <h2>References</h2>
        <ol>
          <li><a href="https://example.com">IRENA cost benchmarks</a></li>
        </ol>
      `;
      const footer = "Approved on 2026-08-20";

      const bytes = await renderPdf(html, footer);

      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBeGreaterThan(0);
      
      // A valid PDF starts with the "%PDF" magic header bytes: 25 50 44 46 (in hex) or "%PDF" in ASCII
      const header = new TextDecoder().decode(bytes.slice(0, 4));
      expect(header).toBe("%PDF");
    }, 20000);
  });

  describe("uploadPdfToDrive", () => {
    it("should upload a PDF to Supabase Storage and return public url", async () => {
      // Mock bucket list to say bucket exists
      mockListBuckets.mockResolvedValue({ data: [{ name: "research-reports" }], error: null });
      // Mock successful upload
      mockUpload.mockResolvedValue({ data: {}, error: null });
      // Mock public url generation
      mockGetPublicUrl.mockReturnValue({ data: { publicUrl: "https://supabase.co/storage/v1/object/public/research-reports/123-report.pdf" } });

      const bytes = new Uint8Array([1, 2, 3]);
      const result = await uploadPdfToDrive("Test Topic.pdf", bytes);

      expect(result.link).toBe("https://supabase.co/storage/v1/object/public/research-reports/123-report.pdf");
      expect(mockUpload).toHaveBeenCalledTimes(1);
    });

    it("should create the storage bucket if it does not exist", async () => {
      // Mock bucket list to say bucket doesn't exist
      mockListBuckets.mockResolvedValue({ data: [], error: null });
      // Mock bucket creation
      mockCreateBucket.mockResolvedValue({ data: {}, error: null });
      mockUpload.mockResolvedValue({ data: {}, error: null });
      mockGetPublicUrl.mockReturnValue({ data: { publicUrl: "https://supabase.co/url" } });

      const bytes = new Uint8Array([1, 2, 3]);
      await uploadPdfToDrive("Test Topic.pdf", bytes);

      expect(mockCreateBucket).toHaveBeenCalledWith("research-reports", { public: true });
    });
  });

  describe("appendLogRow", () => {
    it("should successfully insert a log row into Supabase", async () => {
      mockInsert.mockResolvedValue({ error: null });

      const row = [
        "2026-08-20 00:00",
        "Solar Mini-Grids",
        "tariffs, maintenance",
        "reviewer@test.com",
        1,
        "https://supabase.co/pdf",
        "Approved",
      ];

      const redirectLink = await appendLogRow(row, "https://app-url.com");

      expect(redirectLink).toBe("https://app-url.com/#submission-status");
      expect(mockInsert).toHaveBeenCalledWith({
        logged_at: "2026-08-20 00:00",
        topic: "Solar Mini-Grids",
        subtopics: "tariffs, maintenance",
        reviewer_email: "reviewer@test.com",
        revisions: 1,
        archive_link: "https://supabase.co/pdf",
        status: "Approved",
      });
    });

    it("should fall back to app_settings if database insert fails", async () => {
      // Mock database insert failing
      mockInsert.mockResolvedValue({ error: { message: "Table not found" } });
      
      // Mock reading existing entries in app_settings (none exist)
      mockSelect.mockReturnValue({
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      });

      // Mock upserting updated entries
      mockUpsert.mockResolvedValue({ error: null });

      const row = [
        "2026-08-20 00:00",
        "Solar Mini-Grids",
        "tariffs, maintenance",
        "reviewer@test.com",
        1,
        "https://supabase.co/pdf",
        "Approved",
      ];

      await appendLogRow(row, "https://app-url.com");

      expect(mockUpsert).toHaveBeenCalledTimes(1);
    });
  });
});
