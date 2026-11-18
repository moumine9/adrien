import { MapPinOff } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/states.tsx';
import { buttonVariants } from '@/components/ui/button.tsx';

export function NotFoundView() {
  return (
    <EmptyState
      icon={MapPinOff}
      title="No page here"
      action={
        <Link to="/" className={buttonVariants({ variant: 'neutral' })}>
          Go to the decisions
        </Link>
      }
    >
      This address does not match any view of the decision log.
    </EmptyState>
  );
}
