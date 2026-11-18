/** A page of the docs site: its Markdown source in the repository, its generated file, and its sidebar label. */
export interface DocPage {
  readonly source: string;
  readonly out: string;
  readonly label: string;
}

export declare const REPO_URL: string;

export declare const DOC_PAGES: readonly DocPage[];

/** A GitHub-style heading id: "ADR format" becomes "adr-format". */
export declare function slugify(text: string): string;

export interface RenderDocsOptions {
  /** The repository root, where the Markdown sources are. */
  sourceRoot: string;
  /** The folder to write the pages into. Created when missing. */
  outDir: string;
}

/** Renders every page of DOC_PAGES and returns the file names written, relative to `outDir`. */
export declare function renderDocs(options: RenderDocsOptions): string[];
