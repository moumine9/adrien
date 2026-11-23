import { MapPinOff } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/states.tsx';
import { buttonVariants } from '@/components/ui/button.tsx';
import { useWorkspacePath } from '@/lib/workspace.ts';

export function NotFoundView() {
  const wp = useWorkspacePath();
  return (
    <EmptyState
      icon={MapPinOff}
      title="No page here"
      action={
        <Link to={wp('/')} className={buttonVariants({ variant: 'neutral' })}>
          Go to the decisions
        </Link>
      }
    >
      This address does not match any view of the decision log.
    </EmptyState>
  );
}
