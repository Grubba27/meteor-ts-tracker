import { Computation } from "./Computation";
import { Tracker } from "./tracker";

export class Dependency {
  _state?: any;
  constructor(initialState?: any) {
    this._state = initialState
  }
  getRawValue() {
    return this._state;
  }
  getter() {
    if (Tracker.active)
      this.depend();
    return this._state;
  }
  setter(newValue: any) {
    this._state = newValue;
    this.changed();
  }
  _dependentsById: { [id: number]: Computation } = Object.create(null);

  // http://docs.meteor.com/#dependency_depend
  //
  // Adds `computation` to this set if it is not already
  // present.  Returns true if `computation` is a new member of the set.
  // If no argument, defaults to currentComputation, or does nothing
  // if there is no currentComputation.

  /**
   * @summary Declares that the current computation (or `fromComputation` if given) depends on `dependency`.  The computation will be invalidated the next time `dependency` changes.

   If there is no current computation and `depend()` is called with no arguments, it does nothing and returns false.

   Returns true if the computation is a new dependent of `dependency` rather than an existing one.
   * @locus Client
   * @param {Tracker.Computation} [fromComputation] An optional computation declared to depend on `dependency` instead of the current computation.
   * @returns {Boolean}
   */
  depend(c?: Computation ) {
    const checkComputation = (c: Computation | undefined): false | Computation | null => {
      if (!c) {
        if (!Tracker.active)
          return false;

        return Tracker.currentComputation;
      }
      return c;
    }
    const computation = checkComputation(c);
    if (!computation) return false;

    let id = computation._id;
    if (!(id in this._dependentsById)) {
      this._dependentsById[id] = computation;
      computation.onInvalidate(() => {
        delete this._dependentsById[id];
      });
      return true;
    }
    return false;
  }

  // http://docs.meteor.com/#dependency_changed

  /**
   * @summary Invalidate all dependent computations immediately and remove them as dependents.
   * @locus Client
   */
  changed() {
    for (const id in this._dependentsById)
      this._dependentsById[id].invalidate();
  }

  // http://docs.meteor.com/#dependency_hasdependents

  /**
   * @summary True if this Dependency has one or more dependent Computations, which would be invalidated if this Dependency were to change.
   * @locus Client
   * @returns {Boolean}
   */
  hasDependents() {
    for (const id in this._dependentsById)
      return true;
    return false;
  }
}
