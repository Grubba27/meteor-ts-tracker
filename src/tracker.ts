import {
  afterFlushCallbacks,
  Computation,
  pendingComputations,
  requireFlush,
  setWillFlush,
} from "./Computation";
import { Dependency } from "./Dependency";

const maybeComputation = (): Computation | null => {
  return null
}
// Tracker.Computation constructor is visible but private
// (throws an error if you try to call it)
let constructingComputation = false;
// `true` if we are in Deps.flush now
let inFlush = false;
// `true` if we are computing a computation now, either first time
// or recompute.  This matches Tracker.active unless we are inside
// Deps.nonreactive, which nullfies currentComputation even though
// an enclosing computation may still be running.
export let inCompute = false;
export const setInCompute = (b: boolean) => inCompute = b;
// `true` if the `_throwFirstError` option was passed in to the call
// to Tracker.flush that we are in. When set, throw rather than log the
// first error encountered while flushing. Before throwing the error,
// finish flushing (from a finally block), logging any subsequent
// errors.
export let throwFirstError = false;
export const Tracker = {
  /**
   * @summary True if there is a current computation, meaning that dependencies on reactive data sources will be tracked and potentially cause the current computation to be rerun.
   * @locus Client
   * @type {Boolean}
   */
  active: false,

  /**
   * @summary A Computation object represents code that is repeatedly rerun
   * in response to
   * reactive data changes. Computations don't have return values; they just
   * perform actions, such as rerendering a template on the screen. Computations
   * are created using Tracker.autorun. Use stop to prevent further rerunning of a
   * computation.
   * @instancename computation
   */
  Computation: Computation,
  /**
   * @summary The current computation, or `null` if there isn't one.  The current computation is the [`Tracker.Computation`](#tracker_computation) object created by the innermost active call to `Tracker.autorun`, and it's the computation that gains dependencies when reactive data sources are accessed.
   * @locus Client
   * @type {Tracker.Computation}
   */
  currentComputation: maybeComputation(),
  //
// http://docs.meteor.com/#tracker_dependency

  /**
   * @summary A Dependency represents an atomic unit of reactive data that a
   * computation might depend on. Reactive data sources such as Session or
   * Minimongo internally create different Dependency objects for different
   * pieces of data, each of which may be depended on by multiple computations.
   * When the data changes, the computations are invalidated.
   * @class
   * @instanceName dependency
   */
  Dependency: Dependency,
  /**
   * @summary Process all reactive updates immediately and ensure that all invalidated computations are rerun.
   * @locus Client
   */
  flush: (options?: { _throwFirstError: boolean; }) => {
    Tracker._runFlush({
      finishSynchronously: true,
      throwFirstError: options && options._throwFirstError
    });
  },
  /**
   * @summary True if we are computing a computation now, either first time or recompute.  This matches Tracker.active unless we are inside Tracker.nonreactive, which nullfies currentComputation even though an enclosing computation may still be running.
   * @locus Client
   * @returns {Boolean}
   */
  inFlush: () => inFlush,
  // Run all pending computations and afterFlush callbacks.  If we were not called
// directly via Tracker.flush, this may return before they're all done to allow
// the event loop to run a little before continuing.
  _runFlush: (options?: { throwFirstError?: any; finishSynchronously?: boolean; }) => {
    // XXX What part of the comment below is still true? (We no longer
    // have Spark)
    //
    // Nested flush could plausibly happen if, say, a flush causes
    // DOM mutation, which causes a "blur" event, which runs an
    // app event handler that calls Tracker.flush.  At the moment
    // Spark blocks event handlers during DOM mutation anyway,
    // because the LiveRange tree isn't valid.  And we don't have
    // any useful notion of a nested flush.
    //
    // https://app.asana.com/0/159908330244/385138233856
    if (Tracker.inFlush())
      throw new Error("Can't call Tracker.flush while flushing");

    if (inCompute)
      throw new Error("Can't flush inside Tracker.autorun");

    options = options || {};

    inFlush = true;
    setWillFlush(true);
    throwFirstError = !!options.throwFirstError;

    var recomputedCount = 0;
    var finishedTry = false;
    try {
      while (pendingComputations.length ||
      afterFlushCallbacks.length) {

        // recompute all pending computations
        while (pendingComputations.length) {
          let comp = pendingComputations.shift() as Computation;
          comp._recompute();
          if (comp._needsRecompute()) {
            pendingComputations.unshift(comp);
          }

          if (!options.finishSynchronously && ++recomputedCount > 1000) {
            finishedTry = true;
            return;
          }
        }

        if (afterFlushCallbacks.length) {
          // call one afterFlush callback, which may
          // invalidate more computations
          let func = afterFlushCallbacks.shift() as Function;
          try {
            func();
          } catch (e) {
            throw new Error("Exception from afterFlush function: " + e);
          }
        }
      }
      finishedTry = true;
    } finally {
      if (!finishedTry) {
        // we're erroring due to throwFirstError being true.
        inFlush = false; // needed before calling `Tracker.flush()` again
        // finish flushing
        Tracker._runFlush({
          finishSynchronously: options.finishSynchronously,
          throwFirstError: false
        });
      }
      setWillFlush(false);
      inFlush = false;
      if (pendingComputations.length || afterFlushCallbacks.length) {
        // We're yielding because we ran a bunch of computations and we aren't
        // required to finish synchronously, so we'd like to give the event loop a
        // chance. We should flush again soon.
        if (options.finishSynchronously) {
          throw new Error("still have more to do?");  // shouldn't happen
        }
        setTimeout(requireFlush, 10);
      }
    }
  },

// http://docs.meteor.com/#tracker_autorun
//
// Run f(). Record its dependencies. Rerun it whenever the
// dependencies change.
//
// Returns a new Computation, which is also passed to f.
//
// Links the computation to the current computation
// so that it is stopped if the current computation is invalidated.

  /**
   * @callback Tracker.ComputationFunction
   * @param {Tracker.Computation}
   */
  /**
   * @summary Run a function now and rerun it later whenever its dependencies
   * change. Returns a Computation object that can be used to stop or observe the
   * rerunning.
   * @locus Client
   * @param {Tracker.ComputationFunction} runFunc The function to run. It receives
   * one argument: the Computation object that will be returned.
   * @param {Object} [options]
   * @param {Function} options.onError Optional. The function to run when an error
   * happens in the Computation. The only argument it receives is the Error
   * thrown. Defaults to the error being logged to the console.
   * @returns {Tracker.Computation}
   */
  autorun: (f: (c: Computation) => void, options?: { onError: Function }) => {
    if (typeof f !== 'function')
      throw new Error('Tracker.autorun requires a function argument');

    const { onError } = options || {};

    constructingComputation = true;
    const c = new Tracker.Computation(
      f, Tracker.currentComputation, onError);

    if (Tracker.active)
      Tracker.onInvalidate(function () {
        c.stop();
      });

    return c;
  },
  // http://docs.meteor.com/#tracker_nonreactive
  //
  // Run `f` with no current computation, returning the return value
  // of `f`.  Used to turn off reactivity for the duration of `f`,
  // so that reactive data sources accessed by `f` will not result in any
  // computations being invalidated.

  /**
   * @summary Run a function without tracking dependencies.
   * @locus Client
   * @param {Function} func A function to call immediately.
   */
  nonreactive: (f: Function) => {
    return Tracker.withComputation(null, f);
  },

  /**
   * @summary Registers a new [`onInvalidate`](#computation_oninvalidate) callback on the current computation (which must exist), to be called immediately when the current computation is invalidated or stopped.
   * @locus Client
   * @param {Function} callback A callback function that will be invoked as `func(c)`, where `c` is the computation on which the callback is registered.
   */
  onInvalidate: (f: (c: Computation) => void) => {
    if (!Tracker.active)
      throw new Error("Tracker.onInvalidate requires a currentComputation");

    Tracker.currentComputation!.onInvalidate(f);
  },

  /**
   * @summary Schedules a function to be called during the next flush, or later in the current flush if one is in progress, after all invalidated computations have been rerun.  The function will be run once and not on subsequent flushes unless `afterFlush` is called again.
   * @locus Client
   * @param {Function} callback A function to call at flush time.
   */
  afterFlush: (f: () => void) => {
    afterFlushCallbacks.push(f);
    requireFlush();
  },

  withComputation: (c: Computation | null, f: Function) => {
    const previousComputation = Tracker.currentComputation;

    Tracker.currentComputation = c;
    Tracker.active = !!c;

    try {
      return f();
    } finally {
      Tracker.currentComputation = previousComputation;
      Tracker.active = !!previousComputation;
    }
  }
}

export const createVariable = <T>(initialValue?: T): [
  () => T,
  (value: T) => void,
  () => T
] => {
  const value = new Dependency(initialValue);

  const getter = () => {
    return value.getter();
  }
  const setter = (newValue: T) => {
    return value.setter(newValue);
  }
  const raw = () => value.getRawValue()
  getter.bind(value);
  setter.bind(value);
  return [
    getter,
    setter,
    raw
  ]

}
