import { escape } from './common.ts';
import { icon } from './profile.ts';
import type { GuestInvitation, InvitationState } from './guestbook-invitation.ts';

export type ContributionView =
  | GuestInvitation
  | { state: 'unavailable' }
  | null;

const note =
  'Short postcards, reviewed by the owner before anyone else can see them. The owner shares the guest code separately. An approved note can be featured here, but it never appears automatically.';
const stateCopy: Record<Exclude<InvitationState, 'open'>, string> = {
  paused: 'Guest postcards are paused right now.',
  closed: 'Guest postcards are closed right now.',
  full: 'The review queue is full right now, so new postcards wait until it clears.',
  unavailable: 'The guestbook cannot be reached right now. No message was sent.',
};

export function contributionSection(
  invitation: ContributionView,
  href: (value: string) => string,
) {
  if (!invitation) return '';
  const open = invitation.state === 'open' && 'contribute' in invitation;
  const collection = 'collection' in invitation ? invitation.collection : '';
  const action = open
    ? `<a class="button" href="${escape(href(invitation.contribute))}" rel="noopener noreferrer">Leave a note in the guestbook ${icon('arrow')}</a>`
    : '';
  const browse =
    collection && invitation.state !== 'unavailable'
      ? `<a class="creator-contribution-secondary" href="${escape(href(collection))}" rel="noopener noreferrer">See approved notes ${icon('arrow')}</a>`
      : '';
  return `<section class="creator-contribution" aria-labelledby="guestbook-note-title">
    <div class="creator-contribution-copy">
      <p class="creator-contribution-kicker">The guestbook</p>
      <h2 id="guestbook-note-title">Leave a note</h2>
      <p>${note}</p>
      ${open ? '' : `<p class="creator-contribution-state">${stateCopy[invitation.state as Exclude<InvitationState, 'open'>]}</p>`}
    </div>
    <div class="creator-contribution-actions">${action}${browse}</div>
  </section>`;
}
