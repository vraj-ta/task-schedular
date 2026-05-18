import { Navigate, useParams } from 'react-router-dom';

/**
 * Artifacts live inside the job detail page; this route is a permalink that
 * jumps you to the job's artifacts section. Kept as a separate route so URLs
 * like `/jobs/<id>/artifacts` stay shareable.
 */
export const ArtifactsPage = () => {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/jobs/${id}`} replace />;
};
