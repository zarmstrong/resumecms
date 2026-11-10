// At most `max` tasks running at once, the rest waiting their turn in the
// order they came (issue #120: a gallery's "+ Add images" can pick 24
// files, and the server buffers and re-encodes each one, so the landing
// editor sends its image uploads two at a time). `run(task)` returns at
// once a promise of what `task()` gives once it has had its turn, so the
// caller can track it (on the save queue) from the moment it's asked for,
// not only once it starts. A task that throws or rejects frees its slot
// like any other.
export function createLimiter(max) {
  let running = 0;
  const waiting = [];

  function next() {
    while (running < max && waiting.length) {
      const { task, resolve, reject } = waiting.shift();
      running += 1;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          running -= 1;
          next();
        });
    }
  }

  return function run(task) {
    return new Promise((resolve, reject) => {
      waiting.push({ task, resolve, reject });
      next();
    });
  };
}
