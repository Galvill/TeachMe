export type ParsedQuestion = {
  prompt: string;
  options: { md: string; correct: boolean }[];
  multi: boolean;
  explanation: string | null;
  errors: string[];
};

export type Issue = { file: string; message: string }; // file relative to contentDir, posix
export type TocItem = {
  type: "page" | "quiz";
  path: string;
  title: string;
  section: string | null;
  quizSlug?: string;
};
export type Page = {
  path: string;
  title: string;
  body: string;
  sources: string[];
  file: string;
};
export type Question = Omit<ParsedQuestion, "errors"> & {
  slug: string;
  title: string;
  sources: string[];
  file: string;
};
export type Course = {
  slug: string;
  title: string;
  description: string;
  duration: string | null;
  order: number | null;
  quiz: string | null;
  syncedCommit: string | null;
  intro: string;
  toc: TocItem[];
  pages: Record<string, Page>;
  file: string;
};
export type Quiz = {
  slug: string;
  title: string;
  description: string;
  passingScore: number;
  course: string | null;
  syncedCommit: string | null;
  intro: string;
  questions: Question[];
  file: string;
};
export type Content = {
  courses: Course[];
  quizzes: Quiz[];
  errors: Issue[];
  warnings: Issue[];
};
