export interface WikiPage {
  title: string;
  content: string;
  path: string;
  url: string;
}

export interface WikiSearchResult {
  title: string;
  url: string;
  score: number;
  snippet: string;
}
