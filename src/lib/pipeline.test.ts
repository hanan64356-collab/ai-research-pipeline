import { describe, expect, it } from "vitest";
import {
  splitSubtopics,
  tavilyResults,
  buildReportHtml,
  driveLinkFor,
  pdfNameFor,
  escapeHtml,
} from "./pipeline";

describe("pipeline core utilities", () => {
  describe("splitSubtopics", () => {
    it("should split subtopics by commas", () => {
      const input = "apple, banana, cherry";
      const result = splitSubtopics(input);
      expect(result).toEqual(["apple", "banana", "cherry"]);
    });

    it("should split subtopics by semicolons and newlines", () => {
      const input = "apple; banana\ncherry";
      const result = splitSubtopics(input);
      expect(result).toEqual(["apple", "banana", "cherry"]);
    });

    it("should filter out empty items and trim whitespace", () => {
      const input = "  apple  , , banana ; ; cherry \n \n ";
      const result = splitSubtopics(input);
      expect(result).toEqual(["apple", "banana", "cherry"]);
    });

    it("should return empty array for empty inputs", () => {
      expect(splitSubtopics("")).toEqual([]);
      expect(splitSubtopics("   ")).toEqual([]);
    });
  });

  describe("tavilyResults", () => {
    it("should return at least 3 default results", () => {
      const form = {
        topic: "Machine Learning",
        subtopics: "",
        description: "Test description",
        reviewerEmail: "test@example.com",
      };
      const results = tavilyResults(form);
      expect(results.length).toBe(3);
      expect(results[0]?.title).toContain("Mini-grid deployment");
    });

    it("should append extra results for subtopics", () => {
      const form = {
        topic: "Renewable Energy",
        subtopics: "wind power, hydro energy",
        description: "Test description",
        reviewerEmail: "test@example.com",
      };
      const results = tavilyResults(form);
      expect(results.length).toBe(5); // 3 base + 2 extra
      expect(results[3]?.title).toBe("Wind power — comparative review");
      expect(results[4]?.title).toBe("Hydro energy — comparative review");
    });

    it("should cap extra results to maximum 3", () => {
      const form = {
        topic: "Renewable Energy",
        subtopics: "a, b, c, d, e",
        description: "Test description",
        reviewerEmail: "test@example.com",
      };
      const results = tavilyResults(form);
      expect(results.length).toBe(6); // 3 base + 3 extra
    });
  });

  describe("buildReportHtml", () => {
    const form = {
      topic: "Deep Learning In Medicine",
      subtopics: "diagnostics, imaging",
      description: "A summary for medical practitioners",
      reviewerEmail: "reviewer@test.com",
    };
    const results = [
      { title: "Source 1", url: "https://example.com/1", snippet: "Snippet 1", score: 0.9 },
    ];

    it("should generate valid HTML containing form details", () => {
      const html = buildReportHtml(form, results);
      expect(html).toContain("<!doctype html>");
      expect(html).toContain("Deep Learning In Medicine");
      expect(html).toContain("Prepared for reviewer@test.com");
      expect(html).toContain("A summary for medical practitioners");
      expect(html).toContain("Diagnostics");
      expect(html).toContain("Imaging");
      expect(html).toContain('<a href="https://example.com/1">Source 1</a>');
    });

    it("should display revision history when revision is > 0", () => {
      const feedback = ["Add more tables", "Check year data"];
      const html = buildReportHtml(form, results, 1, feedback);
      expect(html).toContain("Revision 1");
      expect(html).toContain("Add more tables");
      expect(html).toContain("Check year data");
    });
  });

  describe("driveLinkFor and pdfNameFor", () => {
    it("should generate a consistent drive link", () => {
      const topic = "My Research Topic";
      const link1 = driveLinkFor(topic);
      const link2 = driveLinkFor(topic);
      expect(link1).toBe(link2);
      expect(link1).toContain("https://drive.google.com/file/d/");
    });

    it("should generate correct PDF filename", () => {
      const topic = "Research on Cats";
      expect(pdfNameFor(topic)).toBe("Research on Cats - Research Report.pdf");
    });
  });

  describe("escapeHtml", () => {
    it("should escape special HTML characters", () => {
      const raw = 'Cats & Dogs < "Friends" >';
      const escaped = escapeHtml(raw);
      expect(escaped).toBe("Cats &amp; Dogs &lt; &quot;Friends&quot; &gt;");
    });
  });
});
