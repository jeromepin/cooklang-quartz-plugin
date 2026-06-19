// @ts-nocheck

function initRecipe() {
  const display = document.getElementById("servings-display")
  if (!display) return

  const baseServings = parseInt(display.dataset.base ?? "1", 10)
  let currentServings = baseServings

  function smartRound(n) {
    if (Number.isInteger(n)) return n
    const rounded = Math.round(n * 10) / 10
    return Number.isInteger(rounded) ? rounded : rounded
  }

  function updateServings(delta) {
    currentServings = Math.max(1, currentServings + delta)
    display.textContent = String(currentServings)

    const factor = currentServings / baseServings

    document.querySelectorAll(".scalable-value").forEach((el) => {
      const base = parseFloat(el.dataset.base ?? "0")
      el.textContent = String(smartRound(base * factor))
    })

    document.querySelectorAll(".scalable-range").forEach((el) => {
      const baseLow = parseFloat(el.dataset.baseLow ?? "0")
      const baseHigh = parseFloat(el.dataset.baseHigh ?? "0")
      el.textContent = `${smartRound(baseLow * factor)}-${smartRound(baseHigh * factor)}`
    })
  }

  document.querySelectorAll(".servings-btn[data-delta]").forEach((btn) => {
    const delta = parseInt(btn.dataset.delta ?? "0", 10)
    const handler = () => updateServings(delta)
    btn.addEventListener("click", handler)
    window.addCleanup(() => btn.removeEventListener("click", handler))
  })
}

document.addEventListener("nav", initRecipe)
