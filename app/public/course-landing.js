// A cached landing form can only navigate to the public summary, never create a payment.
(() => {
  const form = document.querySelector('form[data-course-checkout]');
  if (!form) return;
  form.noValidate = true;
  form.addEventListener('submit', event => {
    event.preventDefault();
    const slug = String(form.dataset.courseCheckout || '');
    if (/^[a-z0-9][a-z0-9-]{0,100}$/.test(slug)) location.assign('/course-checkout.html?curso=' + encodeURIComponent(slug));
  });
})();
