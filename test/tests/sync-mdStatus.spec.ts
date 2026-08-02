import { getAddon } from "../utils/global";

describe("Sync - Markdown status parsing", function () {
  const addon = getAddon();

  type ParsedStatus = ReturnType<typeof addon.api.sync.getMDStatusFromContent>;

  function parseWithoutThrow(input: string) {
    let status: ParsedStatus | undefined;
    expect(() => {
      status = addon.api.sync.getMDStatusFromContent(input);
    }).not.to.throw();
    if (!status) {
      throw new Error("getMDStatusFromContent returned no status");
    }
    return status;
  }

  function expectFixedEnvelope(status: ParsedStatus) {
    expect(status).to.have.all.keys(
      "meta",
      "content",
      "filedir",
      "filename",
      "lastmodify",
    );
    expect(status.filedir).to.equal("");
    expect(status.filename).to.equal("");
    expect(status.lastmodify.getTime()).to.equal(0);
  }

  function expectFallback(input: string, expectedContent = input) {
    const status = parseWithoutThrow(input);
    expectFixedEnvelope(status);
    expect(status.meta).to.deep.equal({ $version: -1 });
    expect(status.content).to.equal(expectedContent);
  }

  it("preserves headerless Markdown with multiple fence-like body lines", function () {
    const input = [
      "# Document",
      "",
      "A thematic break follows.",
      "---",
      "This is still body content.",
      "---",
      "",
      "```yaml",
      "---",
      "value: a---b",
      "---",
      "```",
      "",
      "| left | right |",
      "| --- | --- |",
      "| a | b |",
      "",
    ].join("\n");

    expectFallback(input);
  });

  const nonOpeningFenceCases = [
    {
      name: "a leading blank line",
      input: "\n---\n$version: 2\n---\nbody",
    },
    {
      name: "leading spaces",
      input: "  ---\n$version: 2\n---\nbody",
    },
    {
      name: "non-whitespace on the opening fence line",
      input: "--- not-front-matter\n$version: 2\n---\nbody",
    },
  ];

  for (const testCase of nonOpeningFenceCases) {
    it(`does not treat front matter after ${testCase.name} as a header`, function () {
      expectFallback(testCase.input);
    });
  }

  const acceptedHeaderCases = [
    {
      name: "an opening fence at the absolute beginning",
      input: "---\n$version: 7\n$libraryID: 4\n$itemKey: ABC123\n---\nbody",
      expectedMeta: {
        $version: 7,
        $libraryID: 4,
        $itemKey: "ABC123",
      },
      expectedContent: "\nbody",
    },
    {
      name: "a single leading BOM",
      input: "\uFEFF---\n$version: 3\n---\nbody",
      expectedMeta: { $version: 3 },
      expectedContent: "\nbody",
    },
    {
      name: "an empty header",
      input: "---\n---\nbody",
      expectedMeta: { $version: -1 },
      expectedContent: "\nbody",
    },
    {
      name: "a whitespace-only header",
      input: "---\n \t\n\t  \n---\nbody",
      expectedMeta: { $version: -1 },
      expectedContent: "\nbody",
    },
    {
      name: "a comment-only header",
      input:
        "---\n# first comment\n   # indented comment\n\t# tabbed comment\n---\nbody",
      expectedMeta: { $version: -1 },
      expectedContent: "\nbody",
    },
    {
      name: "spaces and tabs after both fences",
      input: "--- \t\n$version: 9\n---\t  \nbody",
      expectedMeta: { $version: 9 },
      expectedContent: "\nbody",
    },
    {
      name: "a closing front-matter fence exactly at EOF",
      input: "---\n$version: 10\n$itemKey: EOF123\n---",
      expectedMeta: { $version: 10, $itemKey: "EOF123" },
      expectedContent: "",
    },
  ];

  for (const testCase of acceptedHeaderCases) {
    it(`parses ${testCase.name}`, function () {
      const status = parseWithoutThrow(testCase.input);
      expectFixedEnvelope(status);
      expect(status.meta).to.deep.equal(testCase.expectedMeta);
      expect(status.content).to.equal(testCase.expectedContent);
    });
  }

  it("preserves unknown YAML values and defaults a missing version", function () {
    const input = [
      "---",
      "$libraryID: 23",
      "$itemKey: ITEM1234",
      "marker: a---b",
      "enabled: true",
      "count: 3",
      "nothing: null",
      "tags:",
      "  - alpha",
      "  - beta",
      "nested:",
      "  level: 2",
      "---",
      "body",
    ].join("\n");

    const status = parseWithoutThrow(input);
    expectFixedEnvelope(status);
    expect(status.meta).to.deep.equal({
      $libraryID: 23,
      $itemKey: "ITEM1234",
      marker: "a---b",
      enabled: true,
      count: 3,
      nothing: null,
      tags: ["alpha", "beta"],
      nested: { level: 2 },
      $version: -1,
    });
    expect(status.content).to.equal("\nbody");
  });

  it("returns a plain object containing only own enumerable YAML properties", function () {
    const input = [
      "---",
      "__proto__:",
      "  inherited: unsafe",
      "own: safe",
      "---",
      "body",
    ].join("\n");

    const status = parseWithoutThrow(input);
    expectFixedEnvelope(status);
    const meta = status.meta as NonNullable<ParsedStatus["meta"]> &
      Record<string, unknown>;
    const ordinaryMeta = parseWithoutThrow("---\nordinary: mapping\n---\nbody")
      .meta as NonNullable<ParsedStatus["meta"]>;
    expect(Object.getPrototypeOf(meta)).to.equal(
      Object.getPrototypeOf(ordinaryMeta),
    );
    expect(Object.prototype.hasOwnProperty.call(meta, "inherited")).to.equal(
      false,
    );
    expect(meta.inherited).to.equal(undefined);
    expect(meta.own).to.equal("safe");
    expect(meta.$version).to.equal(-1);
    expect(status.content).to.equal("\nbody");
  });

  it("keeps all whitespace after a successful closing fence", function () {
    const input = "---\n$version: 4\n---\n\n  padded body  \n\n";
    const status = parseWithoutThrow(input);

    expectFixedEnvelope(status);
    expect(status.meta).to.deep.equal({ $version: 4 });
    expect(status.content).to.equal("\n\n  padded body  \n\n");
  });

  it("normalizes CRLF and isolated CR throughout the document", function () {
    const input =
      "---\r\n$version: 6\r$libraryID: 8\r\n---\r\nline 1\rline 2\r\n";
    const status = parseWithoutThrow(input);

    expectFixedEnvelope(status);
    expect(status.meta).to.deep.equal({ $version: 6, $libraryID: 8 });
    expect(status.content).to.equal("\nline 1\nline 2\n");
  });

  const invalidDocumentCases = [
    {
      name: "an unclosed header",
      input: "---\n$version: 1\nbody",
      expectedContent: "---\n$version: 1\nbody",
    },
    {
      name: "invalid YAML",
      input: "---\r\nbroken: [one, two\r\n---\rbody\r\n",
      expectedContent: "---\nbroken: [one, two\n---\nbody\n",
    },
    {
      name: "a scalar YAML root",
      input: "---\nplain scalar\n---\nbody",
      expectedContent: "---\nplain scalar\n---\nbody",
    },
    {
      name: "an array YAML root",
      input: "---\n- one\n- two\n---\nbody",
      expectedContent: "---\n- one\n- two\n---\nbody",
    },
    {
      name: "a null YAML root",
      input: "---\nnull\n---\nbody",
      expectedContent: "---\nnull\n---\nbody",
    },
  ];

  for (const testCase of invalidDocumentCases) {
    it(`falls back without truncating for ${testCase.name}`, function () {
      expectFallback(testCase.input, testCase.expectedContent);
    });
  }

  const invalidKnownFieldCases = [
    { name: "$version has the wrong type", yaml: "$version: '7'" },
    { name: "$libraryID has the wrong type", yaml: "$libraryID: '2'" },
    { name: "$itemKey has the wrong type", yaml: "$itemKey: 123" },
    { name: "$version is NaN", yaml: "$version: .NaN" },
    { name: "$version is infinite", yaml: "$version: .Inf" },
    { name: "$libraryID is NaN", yaml: "$libraryID: .NaN" },
    { name: "$libraryID is infinite", yaml: "$libraryID: .Inf" },
  ];

  for (const testCase of invalidKnownFieldCases) {
    it(`falls back when ${testCase.name}`, function () {
      const input = ["---", testCase.yaml, "---", "body"].join("\n");
      expectFallback(input);
    });
  }
});
