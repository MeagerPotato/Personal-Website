import { follow, hrefFor, useTitle } from '../router';
import { Title } from '../ui/common';

export function Missing() {
  useTitle('Not found');
  return (
    <div className="page">
      <header className="page__head">
        <Title className="page__title">Nothing here</Title>
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
