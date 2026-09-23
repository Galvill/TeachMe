export type ParsedQuestion = {
  prompt: string;
  options: { md: string; correct: boolean }[];
  multi: boolean;
  explanation: string | null;
  errors: string[];
};
