// server component-обёртка
import PenaltiesClient from './PenaltiesClient';
export const dynamic = 'force-dynamic';

export default function Page() {
  return <PenaltiesClient />;
}
