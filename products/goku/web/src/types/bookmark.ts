export type Tag = {
  id: string;
  name: string;
  color: string;
};

export type Category = {
  id: string;
  name: string;
  icon: string;
};

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface CustomStyle {
  container?: React.CSSProperties;
  title?: React.CSSProperties;
  description?: React.CSSProperties;
}

export type Bookmark = {
  id: string;
  title: string;
  url: string;
  description?: string;
  category?: Category;
  tags: Tag[];
  notes: Note[];
  customStyle?: CustomStyle;
  favicon?: string;
  createdAt: number;
  updatedAt: number;
};

export type PaginationState = {
  page: number;
  limit: number;
  hasMore: boolean;
  isLoading: boolean;
};