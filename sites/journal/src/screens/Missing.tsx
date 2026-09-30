/** A path that names no screen, or a day that has not happened yet. */
import { follow, paths } from '../app/router';
import { Bean } from '../ui/Bean';

export function Missing({ future = false }: { future?: boolean }) {
  return (
    <article className="page empty-state">
      <Bean mood={3} family="sky" size={64} />
      <h1 className="page__title">{future ? 'Not yet' : 'Nothing here'}</h1>
      <p className="muted">
        {future
          ? 'That day hasn’t happened yet. Write it when it does.'
          : 'This page doesn’t exist.'}
      </p>
      <a className="button" href={paths.today()} onClick={follow}>
        Go to today
      </a>
    </article>
  );
}
