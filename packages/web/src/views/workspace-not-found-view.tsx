import { Link } from 'react-router';
import { PageHeader } from '@/components/states.tsx';
import { buttonVariants } from '@/components/ui/button.tsx';

/** A `/w/<name>` address for a workspace the server does not serve. */
export function WorkspaceNotFoundView({ name }: { name: string }) {
  return (
    <div className="space-y-6">
      <PageHeader title="No such workspace">{`There is no workspace with the name “${name}”.`}</PageHeader>
      <Link to="/" className={buttonVariants({ variant: 'neutral' })}>
        Back to the start
      </Link>
    </div>
  );
}
