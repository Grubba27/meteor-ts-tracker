import { inCompute, setInCompute, Tracker } from "./tracker";

type TODO = any

let nextId = 1;
// `true` if a Deps.flush is scheduled, or if we are in Deps.flush now
export let willFlush = false;
export const setWillFlush = (b: boolean) => willFlush = b;
// Tracker.Computation constructor is visible but private
// (throws an error if you try to call it)
let constructingComputation = false;
// computations whose callbacks we should call at flush time
export const pendingComputations: Computation[] = [];


export const afterFlushCallbacks: Function[] = [];

export function requireFlush() {
  if (!willFlush) {
    setTimeout(Tracker._runFlush, 0);
    willFlush = true;
  }
}

export class Computation {
  // http://docs.meteor.com/#computation_stopped
  /**
   * @summary True if this computation has been stopped.
   * @locus Client
   * @memberOf Tracker.Computation
   * @instance
   * @name  stopped
   */
  stopped = false;


  // http://docs.meteor.com/#computation_invalidated

  /**
   * @summary True if this computation has been invalidated (and not yet rerun), or if it has been stopped.
   * @locus Client
   * @memberOf Tracker.Computation
   * @instance
   * @name  invalidated
   * @type {Boolean}
   */
  invalidated = false;

  // http://docs.meteor.com/#computation_firstrun

  /**
   * @summary True during the initial run of the computation at the time `Tracker.autorun` is called, and false on subsequent reruns and at other times.
   * @locus Client
   * @memberOf Tracker.Computation
   * @instance
   * @name  firstRun
   * @type {Boolean}
   */
  firstRun = true;
  _id: number;
  _onInvalidateCallbacks: Function[] = [];
  _onStopCallbacks: Function[] = [];
  _parent: Computation | null;
  _func: Function;
  _onError?: Function;
  _recomputing = false;

  constructor(f: Function, parent: Computation | null, onError?: Function) {


    this._id = nextId++;
    // the plan is at some point to use the parent relation
    // to constrain the order that computations are processed
    this._parent = parent;
    this._func = f;
    this._onError = onError;

    let errored = true;
    try {
      this._compute();
      errored = false;
    } finally {
      this.firstRun = false;
      if (errored)
        this.stop();
    }
  }

  // http://docs.meteor.com/#computation_oninvalidate

  /**
   * @summary Registers `callback` to run when this computation is next invalidated, or runs it immediately if the computation is already invalidated.  The callback is run exactly once and not upon future invalidations unless `onInvalidate` is called again after the computation becomes valid again.
   * @locus Client
   * @param {Function} callback Function to be called on invalidation. Receives one argument, the computation that was invalidated.
   */
  onInvalidate(f: Function) {
    if (typeof f !== 'function')
      throw new Error("onInvalidate requires a function");

    if (this.invalidated) {
      Tracker.nonreactive(() => {
        f(this);
      });
    } else {
      this._onInvalidateCallbacks.push(f);
    }
  }

  /**
   * @summary Registers `callback` to run when this computation is stopped, or runs it immediately if the computation is already stopped.  The callback is run after any `onInvalidate` callbacks.
   * @locus Client
   * @param {Function} callback Function to be called on stop. Receives one argument, the computation that was stopped.
   */
  onStop(f: Function) {
    if (typeof f !== 'function')
      throw new Error("onStop requires a function");

    if (this.stopped) {
      Tracker.nonreactive(() => {
        f(this);
      });
    } else {
      this._onStopCallbacks.push(f);
    }
  }

  // http://docs.meteor.com/#computation_invalidate

  /**
   * @summary Invalidates this computation so that it will be rerun.
   * @locus Client
   */
  invalidate() {
    if (!this.invalidated) {
      // if we're currently in _recompute(), don't enqueue
      // ourselves, since we'll rerun immediately anyway.
      if (!this._recomputing && !this.stopped) {
        requireFlush();
        pendingComputations.push(this);
      }

      this.invalidated = true;

      // callbacks can't add callbacks, because
      // this.invalidated === true.
      for (const onInvalidateCallback of this._onInvalidateCallbacks) {
        Tracker.nonreactive(() => {
          onInvalidateCallback(this);
        });
      }
      this._onInvalidateCallbacks = [];
    }
  }

  // http://docs.meteor.com/#computation_stop

  /**
   * @summary Prevents this computation from rerunning.
   * @locus Client
   */
  stop() {
    if (!this.stopped) {
      this.stopped = true;
      this.invalidate();
      for (const onStopCallback of this._onStopCallbacks) {
        Tracker.nonreactive(() => {
          onStopCallback(this);
        });
      }
      this._onStopCallbacks = [];
    }
  }

  _compute() {
    this.invalidated = false;

    var previous = Tracker.currentComputation;
    let previousInCompute = inCompute;
    setInCompute(true);
    try {
      Tracker.withComputation(this, () => {
        this._func(this)
      });
    } finally {
      setInCompute(previousInCompute);
    }
  }

  _needsRecompute() {
    return this.invalidated && !this.stopped;
  }

  _recompute() {
    this._recomputing = true;
    try {
      if (this._needsRecompute()) {
        try {
          this._compute();
        } catch (e) {
          if (this._onError) {
            this._onError(e);
          } else {
            throw e;
          }
        }
      }
    } finally {
      this._recomputing = false;
    }
  }

  /**
   * @summary Process the reactive updates for this computation immediately
   * and ensure that the computation is rerun. The computation is rerun only
   * if it is invalidated.
   * @locus Client
   */
  flush() {
    if (this._recomputing)
      return;

    this._recompute();
  }

  /**
   * @summary Causes the function inside this computation to run and
   * synchronously process all reactive updtes.
   * @locus Client
   */
  run() {
    this.invalidate();
    this.flush();
  }
}
