import { createVariable } from "../../../src";
import { Dependency, Tracker } from "../../../src";

export const setupTrackerElement = (element: HTMLElement) => {
  const [getCounter, setCounter, raw] = createVariable(0)

  Tracker.autorun(() => {
    element.innerHTML = `count is ${getCounter()} with tracker`
  })
  element.addEventListener('click', () => {
    setCounter(raw() + 1)
  })
}
