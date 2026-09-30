import { follow, hrefFor, useTitle } from '../router';

export function Missing() {
  useTitle('Not found');
  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Nothing here</h1>
      </header>
      <p>
        The studio has no page at this address.{' '}
        <a href={hrefFor({ name: 'posts' })} onClick={follow}>
          Back to the posts
        </a>
        .
      </p>
    </div>
  );
}
