  (() => {
    const questions = document.querySelectorAll('.faq-question');
    questions.forEach(btn => {
      btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        const answerId = btn.getAttribute('aria-controls');
        const answer   = document.getElementById(answerId);

        // Close all others
        questions.forEach(other => {
          if (other !== btn) {
            other.setAttribute('aria-expanded', 'false');
            const otherAnswer = document.getElementById(other.getAttribute('aria-controls'));
            if (otherAnswer) otherAnswer.classList.remove('open');
          }
        });

        // Toggle this one
        btn.setAttribute('aria-expanded', String(!expanded));
        if (answer) answer.classList.toggle('open', !expanded);
      });

      // Keyboard: Space / Enter already fires click on <button>
    });
  })();
