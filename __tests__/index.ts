import { test, expect } from '@jest/globals'
import { Computation, Dependency, Tracker } from '../src'

test('tracker - run', () => {
  const d = new Tracker.Dependency();
  let x = 0;
  const handle = Tracker.autorun(() => {
    d.depend();
    ++x;
  });

  expect(x).toBe(1);
  Tracker.flush();
  expect(x).toBe(1);
  d.changed();
  expect(x).toBe(1);
  Tracker.flush();
  expect(x).toBe(2);
  d.changed();
  expect(x).toBe(2);
  Tracker.flush();
  expect(x).toBe(3);
  d.changed();
  handle.stop();
  Tracker.flush();
  expect(x).toBe(3);
  d.changed();
  Tracker.flush();
  expect(x).toBe(3);

  Tracker.autorun(internalHandle => {
    d.depend();
    ++x;
    if (x === 6)
      internalHandle.stop();
  });
  expect(x).toBe(4);
  d.changed();
  Tracker.flush();
  expect(x).toBe(5);
  d.changed();
  Tracker.flush();
  expect(x).toBe(6);
  d.changed();
  Tracker.flush();
  expect(x).toBe(6);

  expect(() => {
    // @ts-ignore
    Tracker.autorun();
  }).toThrow();
  expect(() => {
    // @ts-ignore
    Tracker.autorun({});
  }).toThrow();
});

test('tracker - nested run', () => {
  const a = new Tracker.Dependency();
  const b = new Tracker.Dependency();
  const c = new Tracker.Dependency();
  const d = new Tracker.Dependency();
  const e = new Tracker.Dependency();
  const f = new Tracker.Dependency();

  let buf = '';

  const c1 = Tracker.autorun(() => {
    a.depend();
    buf += 'a';
    Tracker.autorun(() => {
      b.depend();
      buf += 'b';
      Tracker.autorun(() => {
        c.depend();
        buf += 'c';
        const c2 = Tracker.autorun(() => {
          d.depend();
          buf += 'd';
          Tracker.autorun(() => {
            e.depend();
            buf += 'e';
            Tracker.autorun(() => {
              f.depend();
              buf += 'f';
            });
          });
          Tracker.onInvalidate(() => {
            c2.stop();
          });
        });
      });
    });
    Tracker.onInvalidate(c1 => {
      c1.stop();
    });
  });

  const expectResult = (str: string) => {
    expect(buf).toBe(str);
    buf = '';
  };

  expectResult('abcdef');

  expect(a.hasDependents()).toBe(true);
  expect(b.hasDependents()).toBe(true);
  expect(c.hasDependents()).toBe(true);
  expect(d.hasDependents()).toBe(true);
  expect(e.hasDependents()).toBe(true);
  expect(f.hasDependents()).toBe(true);

  b.changed();
  expectResult(''); // didn't flush yet
  Tracker.flush();
  expectResult('bcdef');

  c.changed();
  Tracker.flush();
  expectResult('cdef');

  const changeAndExpect = (v: Dependency, str: string) => {
    v.changed();
    Tracker.flush();
    expectResult(str);
  };

  // should cause running
  changeAndExpect(e, 'ef');
  changeAndExpect(f, 'f');
  // invalidate inner context
  changeAndExpect(d, '');
  // no more running!
  changeAndExpect(e, '');
  changeAndExpect(f, '');

  expect(a.hasDependents()).toBe(true);
  expect(b.hasDependents()).toBe(true);
  expect(c.hasDependents()).toBe(true);
  expect(d.hasDependents()).toBe(false);
  expect(e.hasDependents()).toBe(false);
  expect(f.hasDependents()).toBe(false);

  // rerun C
  changeAndExpect(c, 'cdef');
  changeAndExpect(e, 'ef');
  changeAndExpect(f, 'f');
  // rerun B
  changeAndExpect(b, 'bcdef');
  changeAndExpect(e, 'ef');
  changeAndExpect(f, 'f');

  expect(a.hasDependents()).toBe(true);
  expect(b.hasDependents()).toBe(true);
  expect(c.hasDependents()).toBe(true);
  expect(d.hasDependents()).toBe(true);
  expect(e.hasDependents()).toBe(true);
  expect(f.hasDependents()).toBe(true);

  // kill A
  a.changed();
  changeAndExpect(f, '');
  changeAndExpect(e, '');
  changeAndExpect(d, '');
  changeAndExpect(c, '');
  changeAndExpect(b, '');
  changeAndExpect(a, '');

  expect(a.hasDependents()).toBe(false);
  expect(b.hasDependents()).toBe(false);
  expect(c.hasDependents()).toBe(false);
  expect(d.hasDependents()).toBe(false);
  expect(e.hasDependents()).toBe(false);
  expect(f.hasDependents()).toBe(false);
});

test('tracker - flush', () => {
  let buf = '';

  const c1 = Tracker.autorun(c => {
    buf += 'a';
    // invalidate first time
    if (c.firstRun)
      c.invalidate();
  });

  expect(buf).toBe('a');
  Tracker.flush();
  expect(buf).toBe('aa');
  Tracker.flush();
  expect(buf).toBe('aa');
  c1.stop();
  Tracker.flush();
  expect(buf).toBe('aa');

  //////

  buf = '';

  const c2 = Tracker.autorun(c => {
    buf += 'a';
    // invalidate first time
    if (c.firstRun)
      c.invalidate();

    Tracker.onInvalidate(() => {
      buf += '*';
    });
  });

  expect(buf).toBe('a*');
  Tracker.flush();
  expect(buf).toBe('a*a');
  c2.stop();
  expect(buf).toBe('a*a*');
  Tracker.flush();
  expect(buf).toBe('a*a*');

  /////
  // Can flush a different run from a run;
  // no current computation in afterFlush

  buf = '';

  const c3 = Tracker.autorun(c => {
    buf += 'a';
    // invalidate first time
    if (c.firstRun)
      c.invalidate();
    Tracker.afterFlush(() => {
      buf += (Tracker.active ? "1" : "0");
    });
  });

  Tracker.afterFlush(() => {
    buf += 'c';
  });

  let c4: Computation | undefined;
  Tracker.autorun(c => {
    c4 = c
    buf += 'b';
  });

  Tracker.flush();
  expect(buf).toBe('aba0c0');
  c3.stop();
  c4?.stop();
  Tracker.flush();

  // cases where flush throws

  let ran = false;
  // @ts-ignore
  Tracker.afterFlush(arg => {
    ran = true;
    expect(typeof arg).toBe('undefined');
    expect(() => {
      Tracker.flush(); // illegal nested flush
    }).toThrow();
  });

  Tracker.flush();
  expect(ran).toBe(true);

  expect(() => {
    Tracker.autorun(() => {
      Tracker.flush(); // illegal to flush from a computation
    });
  }).toThrow();

  expect(() => {
    Tracker.autorun(() => {
      Tracker.autorun(() => {});
      Tracker.flush();
    });
  }).toThrow();
});

test('tracker - lifecycle', () => {
  expect(Tracker.active).toBe(false);
  expect(Tracker.currentComputation).toBe(null);

  let runCount = 0;
  let firstRun = true;
  let buf: string[] = [];
  let cbId = 1;
  const makeCb = () => {
    const id = cbId++;
    return () => {
      buf.push(id.toString());
    };
  };

  let shouldStop = false;

  const c1 = Tracker.autorun(c => {
    expect(Tracker.active).toBe(true);
    expect(c).toBe(Tracker.currentComputation);
    expect(c.stopped).toBe(false);
    expect(c.invalidated).toBe(false);
    expect(c.firstRun).toBe(firstRun);

    Tracker.onInvalidate(makeCb()); // 1, 6, ...
    Tracker.afterFlush(makeCb()); // 2, 7, ...

    Tracker.autorun(x => {
      x.stop();
      c.onInvalidate(makeCb()); // 3, 8, ...

      Tracker.onInvalidate(makeCb()); // 4, 9, ...
      Tracker.afterFlush(makeCb()); // 5, 10, ...
    });
    runCount++;

    if (shouldStop)
      c.stop();
  });

  firstRun = false;

  expect(runCount).toBe(1);

  expect(buf).toEqual(['4']);
  c1.invalidate();
  expect(runCount).toBe(1);
  expect(c1.invalidated).toBe(true);
  expect(c1.stopped).toBe(false);
  expect(buf).toEqual(['4', '1', '3']);

  Tracker.flush();

  expect(runCount).toBe(2);
  expect(c1.invalidated).toBe(false);
  expect(buf).toEqual(['4', '1', '3', '9', '2', '5', '7', '10']);

  // test self-stop
  buf = [];
  shouldStop = true;
  c1.invalidate();
  expect(buf).toEqual(['6', '8']);
  Tracker.flush();
  expect(buf).toEqual(['6', '8', '14', '11', '13', '12', '15']);

});

test('tracker - onInvalidate', () => {
  let buf = '';

  const c1 = Tracker.autorun(() => {
    buf += "*";
  });

  const append = (x: string, expectedComputation?: Computation) => {
    return (givenComputation: Computation) => {
      expect(Tracker.active).toBe(false);
      expect(givenComputation).toBe(expectedComputation || c1);
      buf += x;
    };
  };

  c1.onStop(append('s'));

  c1.onInvalidate(append('a'));
  c1.onInvalidate(append('b'));
  expect(buf).toBe('*');
  Tracker.autorun(me => {
    Tracker.onInvalidate(append('z', me));
    me.stop();
    expect(buf).toBe('*z');
    c1.invalidate();
  });
  expect(buf).toBe('*zab');
  c1.onInvalidate(append('c'));
  c1.onInvalidate(append('d'));
  expect(buf).toBe('*zabcd');
  Tracker.flush();
  expect(buf).toBe('*zabcd*');

  // afterFlush ordering
  buf = '';
  c1.onInvalidate(append('a'));
  c1.onInvalidate(append('b'));
  Tracker.afterFlush(() => {
    append('x')(c1);
    c1.onInvalidate(append('c'));
    c1.invalidate();
    Tracker.afterFlush(() => {
      append('y')(c1);
      c1.onInvalidate(append('d'));
      c1.invalidate();
    });
  });
  Tracker.afterFlush(() => {
    append('z')(c1);
    c1.onInvalidate(append('e'));
    c1.invalidate();
  });

  expect(buf).toBe('');
  Tracker.flush();
  expect(buf).toBe('xabc*ze*yd*');

  buf = "";
  c1.onInvalidate(append('m'));
  Tracker.flush();
  expect(buf).toBe('');
  c1.stop();
  expect(buf).toBe('ms');  // s is from onStop
  Tracker.flush();
  expect(buf).toBe('ms');
  c1.onStop(append('S'));
  expect(buf).toBe('msS');
});

test('tracker - invalidate at flush time', () => {
  // Test this sentence of the docs: Functions are guaranteed to be
  // called at a time when there are no invalidated computations that
  // need rerunning.

  let buf: string[] = [];

  Tracker.afterFlush(() => {
    buf.push('C');
  });

  // When c1 is invalidated, it invalidates c2, then stops.
  const c1 = Tracker.autorun(c => {
    if (!c.firstRun) {
      buf.push('A');
      c2.invalidate();
      c.stop();
    }
  });

  const c2 = Tracker.autorun(c => {
    if (!c.firstRun) {
      buf.push('B');
      c.stop();
    }
  });

  // Invalidate c1.  If all goes well, the re-running of
  // c2 should happen before the afterFlush.
  c1.invalidate();
  Tracker.flush();

  expect(buf.join('')).toBe('ABC');

});

test('tracker - throwFirstError', () => {
  const d = new Tracker.Dependency();
  Tracker.autorun(c => {
    d.depend();

    if (!c.firstRun) throw new Error("foo");
  });

  d.changed();
  expect(() => {
    Tracker.flush({ _throwFirstError: true });
  }).toThrow(/foo/);
});

test('tracker - no infinite recomputation', done => {
  let reran = false;
  const c = Tracker.autorun(c => {
    if (!c.firstRun)
      reran = true;
    c.invalidate();
  });
  expect(reran).toBe(false);
  setTimeout(() => {
    c.stop();
    Tracker.afterFlush(() => {
      expect(reran).toBe(true);
      expect(c.stopped).toBe(true);
      done();
    });
  }, 100);
});

test('tracker - Tracker.flush finishes', () => {
  // Currently, _runFlush will "yield" every 1000 computations... unless run in
  // Tracker.flush. So this test validates that Tracker.flush is capable of
  // running 2000 computations. Which isn't quite the same as infinity, but it's
  // getting there.
  let n = 0;
  const c = Tracker.autorun(c => {
    if (++n < 2000) {
      c.invalidate();
    }
  });
  expect(n).toBe(1);
  Tracker.flush();
  expect(n).toBe(2000);
});

test('computation - #flush', () => {
  let i = 0, j = 0, d = new Tracker.Dependency();
  const c1 = Tracker.autorun(() => {
    d.depend();
    i = i + 1;
  });
  const c2 = Tracker.autorun(() => {
    d.depend();
    j = j + 1;
  });
  expect(i).toBe(1);
  expect(j).toBe(1);

  d.changed();
  c1.flush();
  expect(i).toBe(2);
  expect(j).toBe(1);

  Tracker.flush();
  expect(i).toBe(2);
  expect(j).toBe(2);
});

test('computation - #run', () => {
  let i = 0, d = new Tracker.Dependency(), d2 = new Tracker.Dependency();
  const computation = Tracker.autorun(c => {
    d.depend();
    i = i + 1;
    //when #run() is called, this dependency should be picked up
    if (i >= 2 && i < 4) { d2.depend(); }
  });
  expect(i).toBe(1);
  computation.run();
  expect(i).toBe(2);

  d.changed(); Tracker.flush();
  expect(i).toBe(3);

  //we expect to depend on d2 at this point
  d2.changed(); Tracker.flush();
  expect(i).toBe(4);

  //we no longer depend on d2, only d
  d2.changed(); Tracker.flush();
  expect(i).toBe(4);
  d.changed(); Tracker.flush();
  expect(i).toBe(5);
});
