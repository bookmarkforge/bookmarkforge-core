declare module "html2pdf.js" {
  interface Html2PdfOptions {
    margin?: number | [number, number, number, number];
    filename?: string;
    image?: { type?: string; quality?: number };
    html2canvas?: any;
    jsPDF?: any;
    pagebreak?: any;
  }

  interface Html2Pdf {
    set(options: Html2PdfOptions): Html2Pdf;
    from(element: HTMLElement | string): Html2Pdf;
    save(): Promise<void>;
    output(type: string, options?: any): Promise<any>;
    outputPdf(type?: string): Promise<any>;
  }

  function html2pdf(): Html2Pdf;
  function html2pdf(
    element: HTMLElement | string,
    options?: Html2PdfOptions,
  ): Html2Pdf;

  export default html2pdf;
}
