import { Link } from 'react-router-dom';
import { EmptyState } from '../components/Feedback.jsx';

export function NotFoundPage() {
  return (
    <div className="panel">
      <EmptyState
        title="Page not found"
        action={
          <Link to="/" className="btn">
            Back to overview
          </Link>
        }
      >
        The page you are looking for does not exist.
      </EmptyState>
    </div>
  );
}
