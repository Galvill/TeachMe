import { useParams } from "react-router";

/** Placeholder: replaced by the quiz experience in a later task. */
export default function QuizView() {
  const { slug } = useParams();
  return (
    <main className="page">
      <h1>{slug}</h1>
    </main>
  );
}
