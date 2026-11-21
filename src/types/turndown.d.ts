declare module "turndown" {
  interface TurndownOptions {
    headingStyle?: "setext" | "atx";
    hr?: string;
    bulletListMarker?: "-" | "+" | "*";
    codeBlockStyle?: "indented" | "fenced";
    fence?: "```" | "~~~";
    emDelimiter?: "_" | "*";
    strongDelimiter?: "**" | "__";
    linkStyle?: "inlined" | "referenced";
    linkReferenceStyle?: "full" | "collapsed" | "shortcut";
    preformattedCode?: boolean;
  }

  interface TurndownService {
    turndown(html: string | Node): string;
    addRule(
      key: string,
      rule: {
        filter: string | string[] | ((node: Node) => boolean);
        replacement: (content: string, node: Node) => string;
      },
    ): void;
    keep(filter: string | string[] | ((node: Node) => boolean)): void;
    remove(filter: string | string[] | ((node: Node) => boolean)): void;
    use(plugin: unknown): void;
  }

  interface TurndownStatic {
    new (options?: TurndownOptions): TurndownService;
  }

  const TurndownService: TurndownStatic;
  export default TurndownService;
}
