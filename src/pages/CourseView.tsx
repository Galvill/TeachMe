import { useParams } from "react-router";

/** Placeholder: replaced by the course experience in a later task. */
export default function CourseView() {
  const { slug } = useParams();
  return (
    <main className="page">
      <h1>{slug}</h1>
    </main>
  );
}
