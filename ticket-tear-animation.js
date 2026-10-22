// V14.5: Presentation-only tear effect. Never changes a ticket's server-side state.
// The pieces stay apart until endTicketTear(), even when the animation finishes.
const $ = id => document.getElementById(id);
let ongoing = null;

function write(id, value) {
  $(id).textContent = String(value ?? '');
}

export function beginTicketTear(reservation, options = {}) {
  endTicketTear();
  const ticket = $('ticketTear');
  const screen = $('ticketScreen');
  const upper = $('ticketTearUpper');
  const labels = options.labels || {};
  write('ticketTearNumberLabel', labels.reservationNumber);
  write('ticketTearCode', reservation.id || '-');
  write('ticketTearNameLabel', labels.name);
  write('ticketTearName', reservation.employeeName || '-');
  write('ticketTearIdLabel', labels.staffNumber);
  write('ticketTearId', reservation.employeeId || '-');
  write('ticketTearPlant', `Plant ${reservation.plant || '-'}`);
  write('ticketTearMeal', options.meal || '-');

  ticket.classList.remove('hidden', 'is-animating', 'is-separated');
  ticket.setAttribute('aria-hidden', 'false');
  screen.classList.add('is-tearing');

  let timer = null;
  let done = false;
  let resolveAnimation;
  const finished = new Promise(resolve => { resolveAnimation = resolve; });
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    upper.removeEventListener('animationend', onFinish);
    ticket.classList.add('is-separated');
    resolveAnimation();
  };
  const onFinish = event => { if (event.target === upper) finish(); };
  ongoing = { finish };

  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    ticket.classList.add('is-separated');
    finish();
  } else {
    upper.addEventListener('animationend', onFinish);
    // Give the browser an opportunity to paint the intact ticket before tearing.
    timer = setTimeout(finish, 950); // Also covers throttled/hidden animation frames.
    requestAnimationFrame(() => {
      if (done) return;
      ticket.classList.add('is-animating');
    });
  }
  return finished;
}

export function endTicketTear() {
  if (ongoing) {
    ongoing.finish();
    ongoing = null;
  }
  const ticket = $('ticketTear');
  if (!ticket) return;
  ticket.classList.add('hidden');
  ticket.classList.remove('is-animating', 'is-separated');
  ticket.setAttribute('aria-hidden', 'true');
  $('ticketScreen').classList.remove('is-tearing');
}

// The server call starts concurrently with the animation; success cannot be
// displayed before BOTH the animation and server call have settled.
// Settling both also avoids an unhandled promise rejection on a fast failure.
export async function awaitTearAndClaim(animation, serverClaim) {
  const [, claim] = await Promise.allSettled([animation, serverClaim]);
  if (claim.status === 'rejected') throw claim.reason;
  return claim.value;
}
