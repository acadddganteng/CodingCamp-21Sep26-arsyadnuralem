// app.js — Expense & Budget Visualizer
// Single-file application logic. No build tools, no ES modules.
// Works via file://, static HTTP server, and browser extension sandbox.

// =============================================================================
// === Constants ===
// =============================================================================

/** Category enum — valid transaction categories */
const CATEGORIES = {
  Food: 'Food',
  Transport: 'Transport',
  Fun: 'Fun',
};

/** Maximum length for a transaction item name */
const NAME_MAX_LEN = 100;

/** Minimum allowed transaction amount */
const AMOUNT_MIN = 0.01;

/** Maximum allowed transaction amount */
const AMOUNT_MAX = 999999999.99;

/** Maximum characters to display for an item name in the transaction list */
const DISPLAY_TRUNCATE_LEN = 50;

/** Local Storage key for persisting transaction data */
const STORAGE_KEY = 'expense_visualizer_transactions';

// =============================================================================
// === State ===
// =============================================================================

/**
 * @typedef {Object} Transaction
 * @property {string} id        - UUID v4 generated at creation time (crypto.randomUUID)
 * @property {string} name      - Item name (1–100 characters)
 * @property {number} amount    - Positive number, max 2 decimal places (0.01–999999999.99)
 * @property {string} category  - One of: "Food" | "Transport" | "Fun"
 * @property {number} createdAt - Unix timestamp (Date.now()) for ordering
 */

/**
 * @typedef {Object} AppState
 * @property {Transaction[]} transactions - Ordered list; append-only via UI
 * @property {boolean} storageAvailable   - Whether Local Storage is accessible
 */

/** In-memory application state — single source of truth for the current session */
const state = {
  transactions: [],
  storageAvailable: true,
};

// =============================================================================
// === StorageService ===
// =============================================================================

/**
 * All Local Storage read/write/parse operations.
 * Callers should not interact with localStorage directly.
 */
const StorageService = {
  /**
   * Serialize a list of transactions to a JSON string.
   * @param {Transaction[]} list
   * @returns {string} JSON-encoded string
   */
  serialize(list) {
    return JSON.stringify(list);
  },

  /**
   * Deserialize a JSON string back into an array of transactions.
   * Throws a SyntaxError if the JSON is malformed.
   * @param {string} json
   * @returns {Transaction[]} Parsed transaction array
   * @throws {SyntaxError} If json cannot be parsed
   */
  deserialize(json) {
    try {
      return JSON.parse(json);
    } catch (err) {
      throw err;
    }
  },

  /**
   * Persist the transaction list to Local Storage.
   * Wraps localStorage.setItem in a try/catch; on failure shows #storage-error banner.
   * Does NOT roll back in-memory state on failure.
   *
   * Requirements: 3.1, 3.2
   *
   * @param {Transaction[]} list - The current transaction array to persist
   */
  write(list) {
    try {
      localStorage.setItem(STORAGE_KEY, StorageService.serialize(list));
      return true;
    } catch (err) {
      const banner = document.getElementById('storage-error');
      if (banner) banner.removeAttribute('hidden');
      return false;
    }
  },

  /**
   * Read and parse the transaction list from Local Storage.
   *
   * - SecurityError (storage blocked, e.g. file:// with restricted access):
   *     sets state.storageAvailable = false, shows #storage-unavailable-banner, returns []
   * - SyntaxError (malformed JSON):
   *     discards data, shows #storage-corrupt-banner, returns []
   * - No prior data (null / empty string):
   *     returns []
   * - Success:
   *     returns the parsed Transaction array
   *
   * @returns {Transaction[]} Stored transactions, or [] on any failure
   */
  load() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      // localStorage access blocked (e.g. SecurityError in file:// mode)
      state.storageAvailable = false;
      const banner = document.getElementById('storage-unavailable-banner');
      if (banner) banner.removeAttribute('hidden');
      return [];
    }

    // Nothing stored yet — treat as empty list
    if (raw === null || raw === '') {
      return [];
    }

    try {
      return StorageService.deserialize(raw);
    } catch (err) {
      // Malformed JSON — discard corrupted data
      const banner = document.getElementById('storage-corrupt-banner');
      if (banner) banner.removeAttribute('hidden');
      return [];
    }
  },
};

// =============================================================================
// === TransactionService ===
// =============================================================================

/**
 * Business logic: create, delete, validate, compute balance, compute category totals.
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean}  valid   - Whether all fields passed validation
 * @property {string[]} errors  - Human-readable error messages (empty if valid)
 */

/**
 * Validate the raw form fields for a new transaction.
 * Collects ALL validation errors rather than short-circuiting on the first failure,
 * so that the UI can surface all issues to the user at once.
 *
 * @param {{ name: string, amount: string|number, category: string }} fields
 * @returns {ValidationResult}
 */
function validateTransaction(fields) {
  const errors = [];
  const { name, amount, category } = fields;

  // --- Name validation ---
  if (typeof name !== 'string' || name.trim().length === 0) {
    errors.push('Item name is required.');
  } else if (name.length > NAME_MAX_LEN) {
    errors.push(`Item name must not exceed ${NAME_MAX_LEN} characters.`);
  }

  // --- Amount validation ---
  const numericAmount = Number(amount);
  if (amount === '' || amount === null || amount === undefined || isNaN(numericAmount)) {
    errors.push('Amount is required and must be a number.');
  } else if (numericAmount <= 0) {
    errors.push('Amount must be greater than zero.');
  } else if (numericAmount > AMOUNT_MAX) {
    errors.push(`Amount must not exceed ${AMOUNT_MAX.toLocaleString('en-US', { minimumFractionDigits: 2 })}.`);
  }

  // --- Category validation ---
  const validCategories = Object.values(CATEGORIES);
  if (!category || !validCategories.includes(category)) {
    errors.push(`Category must be one of: ${validCategories.join(', ')}.`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create a new transaction, append it to state, persist to storage, and return it.
 *
 * @param {string} name     - Item name (already validated)
 * @param {number} amount   - Positive amount (already validated)
 * @param {string} category - One of: "Food" | "Transport" | "Fun" (already validated)
 * @returns {Transaction} The newly created transaction object
 */
function createTransaction(name, amount, category) {
  const transaction = {
    id: crypto.randomUUID(),
    name,
    amount: Number(amount),
    category,
    createdAt: Date.now(),
  };

  state.transactions.push(transaction);
  StorageService.write(state.transactions);

  return transaction;
}

/**
 * Return a new array with the transaction matching the given id removed.
 * The original list is not mutated. The order of remaining items is preserved.
 *
 * @param {Transaction[]} list - The current transaction array
 * @param {string} id          - The id of the transaction to remove
 * @returns {Transaction[]} A new array without the target transaction
 */
function deleteTransaction(list, id) {
  return list.filter(transaction => transaction.id !== id);
}

/**
 * Compute the total balance as the arithmetic sum of all transaction amounts,
 * rounded to two decimal places. Returns 0.00 for an empty list.
 *
 * Requirements: 4.1, 4.4
 *
 * @param {Transaction[]} transactions - The list of transactions to sum
 * @returns {number} The total balance rounded to two decimal places (0.00 for empty list)
 */
function computeBalance(transactions) {
  if (transactions.length === 0) return 0.00;
  const sum = transactions.reduce((acc, t) => acc + t.amount, 0);
  return Math.round(sum * 100) / 100;
}

/**
 * Compute the total amount per category across all transactions.
 * Only categories with at least one transaction are included in the result.
 * For an empty transactions array, returns an empty object.
 *
 * Requirements: 5.1, 5.2
 *
 * @param {Transaction[]} transactions - The list of transactions to aggregate
 * @returns {Object.<string, number>} An object mapping category name → sum of amounts
 *   Example: { Food: 15, Transport: 20 }  (Fun absent if no Fun transactions exist)
 */
function computeCategoryTotals(transactions) {
  return transactions.reduce((totals, t) => {
    if (Object.prototype.hasOwnProperty.call(totals, t.category)) {
      totals[t.category] += t.amount;
    } else {
      totals[t.category] = t.amount;
    }
    return totals;
  }, {});
}

/**
 * Truncate a transaction item name for display in the transaction list.
 * If the name is longer than DISPLAY_TRUNCATE_LEN (50) characters, returns the
 * first 50 characters. Otherwise returns the name unchanged.
 *
 * Requirements: 2.2
 *
 * @param {string} name - The full item name
 * @returns {string} The name truncated to at most 50 characters
 */
function truncateForDisplay(name) {
  if (name.length > DISPLAY_TRUNCATE_LEN) {
    return name.slice(0, DISPLAY_TRUNCATE_LEN);
  }
  return name;
}

// =============================================================================
// === ChartService ===
// =============================================================================

/**
 * Chart.js instance management: init, update, destroy.
 * Holds the single Chart.js instance reference and provides methods to
 * initialise and update the pie chart without destroying/recreating it.
 */
const ChartService = {
  /** @type {import('chart.js').Chart|null} Active Chart.js instance, or null if not yet initialised */
  chart: null,

  /**
   * Initialise the Chart.js pie chart on the #spending-chart canvas.
   *
   * - If Chart.js is not available (CDN failed to load), shows a fallback
   *   message inside the chart container and returns early.
   * - Otherwise creates a new Chart.js pie instance on #spending-chart,
   *   stores the reference in this.chart, then hides the canvas and shows
   *   #chart-empty-msg (no data on startup).
   *
   * Requirements: 5.5, 5.6
   */
  init() {
    const canvas = document.getElementById('spending-chart');
    const emptyMsg = document.getElementById('chart-empty-msg');
    const chartContainer = canvas && canvas.parentElement;

    // Guard: Chart.js failed to load from CDN
    if (typeof Chart === 'undefined') {
      if (chartContainer) {
        const fallback = document.createElement('p');
        fallback.className = 'chart-unavailable-msg';
        fallback.textContent = 'Chart unavailable. Could not load the charting library.';
        chartContainer.appendChild(fallback);
      }
      if (canvas) canvas.setAttribute('hidden', '');
      return;
    }

    if (!canvas) return;

    // Create the Chart.js pie instance with empty data.
    // Data is populated on first ChartService.update() call.
    this.chart = new Chart(canvas, {
      type: 'pie',
      data: {
        labels: [],
        datasets: [
          {
            data: [],
            backgroundColor: [
              '#4CAF50', // Food — green
              '#2196F3', // Transport — blue
              '#FF9800', // Fun — orange
            ],
            borderWidth: 2,
            borderColor: '#ffffff',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'bottom',
          },
          tooltip: {
            callbacks: {
              label(context) {
                const total = context.dataset.data.reduce((sum, v) => sum + v, 0);
                const value = context.parsed;
                const pct = total > 0 ? Math.round((value / total) * 100) : 0;
                return ` ${context.label}: ${pct}%`;
              },
            },
          },
        },
      },
    });

    // No transactions yet — hide canvas, show empty-state message
    canvas.setAttribute('hidden', '');
    if (emptyMsg) emptyMsg.removeAttribute('hidden');
  },

  /**
   * Update the pie chart to reflect the current category totals.
   *
   * - If categoryTotals is empty (no categories), hides the canvas and shows
   *   the #chart-empty-msg paragraph.
   * - Otherwise, shows the canvas, hides the empty message, updates chart data
   *   in-place (labels + dataset values), and calls chart.update() to re-render.
   * - Never destroys and recreates the Chart.js instance (keeps within the
   *   300 ms update budget — Requirement 7.2).
   * - Guards against this.chart being null (e.g., Chart.js failed to load).
   *
   * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
   *
   * @param {Object.<string, number>} categoryTotals - Category name → total amount,
   *   e.g. { Food: 45.00, Transport: 20.50 }.  Pass {} when the list is empty.
   */
  update(categoryTotals) {
    const canvas = document.getElementById('spending-chart');
    const emptyMsg = document.getElementById('chart-empty-msg');

    const hasData = Object.keys(categoryTotals).length > 0;

    if (!hasData) {
      // No transactions — hide chart, show empty-state message
      if (canvas) canvas.setAttribute('hidden', '');
      if (emptyMsg) emptyMsg.removeAttribute('hidden');
      return;
    }

    // Has data — show chart, hide empty-state message
    if (canvas) canvas.removeAttribute('hidden');
    if (emptyMsg) emptyMsg.setAttribute('hidden', '');

    // Update in-place only if the Chart.js instance exists
    if (!this.chart) return;

    this.chart.data.labels = Object.keys(categoryTotals);
    this.chart.data.datasets[0].data = Object.values(categoryTotals);
    this.chart.update();
  },
};

// =============================================================================
// === Renderer ===
// =============================================================================

/**
 * Pure DOM mutation functions: render list, render balance, render chart.
 * All render functions are idempotent — calling them at any time produces a
 * consistent view of the current state.
 */
const Renderer = {
  /**
   * Re-render the transaction list from scratch.
   *
   * - Clears the `<ul id="transaction-list">` element.
   * - If `transactions` is empty, appends a single empty-state `<li>`.
   * - Otherwise appends one `<li>` per transaction (in array order, so most
   *   recently added appears last — Requirement 2.1), containing:
   *     • item name (truncated to 50 chars via `truncateForDisplay`; full name
   *       stored in `data-fullname` for reference — Requirement 2.2)
   *     • amount formatted as `$X,XXX.XX` (Requirement 2.2)
   *     • category label
   *     • delete button with `data-id` and `aria-label` (Requirements 2.4, 8.3)
   *
   * Requirements: 2.1, 2.2, 2.3, 2.4, 2.7
   *
   * @param {Transaction[]} transactions - The current transaction array
   */
  renderTransactionList(transactions) {
    const list = document.getElementById('transaction-list');
    if (!list) return;

    list.innerHTML = '';

    if (transactions.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty-state';
      empty.textContent = 'No transactions added yet.';
      list.appendChild(empty);
      return;
    }

    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

    transactions.forEach(transaction => {
      const li = document.createElement('li');
      li.className = 'transaction-item';

      // Item name — truncated for display, full value in data attribute
      const nameSpan = document.createElement('span');
      nameSpan.className = 'transaction-name';
      nameSpan.textContent = truncateForDisplay(transaction.name);
      nameSpan.dataset.fullname = transaction.name;

      // Amount — formatted as $X,XXX.XX
      const amountSpan = document.createElement('span');
      amountSpan.className = 'transaction-amount';
      amountSpan.textContent = formatter.format(transaction.amount);

      // Category label
      const categorySpan = document.createElement('span');
      categorySpan.className = 'transaction-category';
      categorySpan.textContent = transaction.category;

      // Delete button — data-id for event delegation, aria-label for accessibility
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'delete-btn';
      deleteBtn.dataset.id = transaction.id;
      deleteBtn.setAttribute('aria-label', `Delete ${truncateForDisplay(transaction.name)}`);
      deleteBtn.textContent = 'Delete';

      li.appendChild(nameSpan);
      li.appendChild(amountSpan);
      li.appendChild(categorySpan);
      li.appendChild(deleteBtn);
      list.appendChild(li);
    });
  },

  /**
   * Update the Balance_Display to reflect the sum of all transaction amounts.
   *
   * Reads the computed balance from `computeBalance(transactions)` and writes it
   * into the `#balance-amount` span formatted as `$X,XXX.XX`.
   * When transactions is empty, displays `$0.00` (Requirement 4.4).
   *
   * Requirements: 4.1, 4.2, 4.3, 4.4
   *
   * @param {Transaction[]} transactions - The current transaction array
   */
  renderBalance(transactions) {
    const balanceEl = document.getElementById('balance-amount');
    if (!balanceEl) return;

    const total = computeBalance(transactions);
    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
    balanceEl.textContent = formatter.format(total);
  },

  /**
   * Single re-render entry point — called after every state mutation (add, delete, load).
   *
   * Calls, in order:
   *  1. renderTransactionList(transactions) — refreshes the list DOM
   *  2. renderBalance(transactions)         — updates the Balance_Display
   *  3. ChartService.update(computeCategoryTotals(transactions)) — refreshes the pie chart
   *
   * Requirements: 4.2, 4.3, 5.3, 5.4
   *
   * @param {Transaction[]} transactions - The current transaction array
   */
  renderAll(transactions) {
    this.renderTransactionList(transactions);
    this.renderBalance(transactions);
    ChartService.update(computeCategoryTotals(transactions));
  },
};

// =============================================================================
// === FormHandler ===
// =============================================================================

/**
 * Handles user-initiated form interactions: submit (add transaction) and delete.
 */
const FormHandler = {
  /**
   * Handle the transaction form submit event.
   *
   * 1. Prevents default form submission.
   * 2. Reads name, amount, and category from the form fields.
   * 3. Validates the fields using validateTransaction().
   * 4. On validation failure:
   *    - Populates #form-error with all error messages (one per line).
   *    - Preserves all current field values (does NOT reset the form).
   * 5. On validation success:
   *    - Clears #form-error.
   *    - Creates the transaction via createTransaction().
   *    - Re-renders all UI components via Renderer.renderAll().
   *    - Resets the form to its default empty state (Requirement 1.7).
   *
   * Requirements: 1.3, 1.4, 1.5, 1.6, 1.7
   *
   * @param {Event} event - The form submit event
   */
  handleSubmit(event) {
    event.preventDefault();

    const form = event.target;
    const name = form.querySelector('#item-name') ? form.querySelector('#item-name').value : '';
    const amount = form.querySelector('#item-amount') ? form.querySelector('#item-amount').value : '';
    const category = form.querySelector('#item-category') ? form.querySelector('#item-category').value : '';

    const errorEl = document.getElementById('form-error');

    const result = validateTransaction({ name, amount, category });

    if (!result.valid) {
      // Show all error messages; preserve field values (no reset)
      if (errorEl) {
        errorEl.textContent = result.errors.join(' ');
        errorEl.removeAttribute('hidden');
      }
      return;
    }

    // Validation passed — clear any previous error, create transaction, re-render, reset
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.setAttribute('hidden', '');
    }

    createTransaction(name, Number(amount), category);
    Renderer.renderAll(state.transactions);
    form.reset();
  },

  /**
   * Handle a click event on the transaction list to delete a transaction.
   *
   * 1. Reads event.target.dataset.id — if absent, the click was not on a delete
   *    button, so returns early.
   * 2. Locates the transaction in state before removing it (needed for rollback).
   * 3. Calls deleteTransaction() and assigns the result back to state.transactions.
   * 4. Calls StorageService.write():
   *    - On failure: rolls back the in-memory deletion (re-inserts at the original
   *      position), shows #delete-error, and re-renders.
   *    - On success: re-renders all UI components.
   *
   * Requirements: 2.5, 2.6, 3.2
   *
   * @param {Event} event - The click event bubbling up from the transaction list
   */
  handleDelete(event) {
    const id = event.target.dataset.id;
    if (!id) return; // click was not on a delete button

    // Find the transaction before removing it (needed for rollback)
    const index = state.transactions.findIndex(t => t.id === id);
    if (index === -1) return; // transaction not found
    const removed = state.transactions[index];

    // Remove from in-memory state
    state.transactions = deleteTransaction(state.transactions, id);

    // Persist — rollback if write fails (Requirement 2.6, 3.2)
    const writeOk = StorageService.write(state.transactions);
    if (!writeOk) {
      // Rollback: re-insert at original position
      state.transactions.splice(index, 0, removed);
      const deleteErrorEl = document.getElementById('delete-error');
      if (deleteErrorEl) deleteErrorEl.removeAttribute('hidden');
      Renderer.renderAll(state.transactions);
      return;
    }

    Renderer.renderAll(state.transactions);
  },
};

// =============================================================================
// === EventBootstrap ===
// =============================================================================

/**
 * Attaches all event listeners for the application.
 * Call EventBootstrap.init() once the DOM is ready (from DOMContentLoaded).
 */
const EventBootstrap = {
  /**
   * Wire up all event listeners:
   *  1. `submit` on #transaction-form → FormHandler.handleSubmit
   *  2. Delegated `click` on #transaction-list → FormHandler.handleDelete
   *     (only fires when the clicked element is a delete button carrying data-id)
   *
   * Requirements: 1.2, 2.4, 2.5
   */
  init() {
    // 1. Form submission — add a new transaction
    const form = document.getElementById('transaction-form');
    if (form) {
      form.addEventListener('submit', FormHandler.handleSubmit);
    }

    // 2. Delegated delete — single listener on the list container handles all
    //    delete buttons regardless of how many transactions are rendered
    const list = document.getElementById('transaction-list');
    if (list) {
      list.addEventListener('click', function (event) {
        // Walk up the DOM from the click target to find a button with data-id.
        // Using closest() makes it robust even if the button has child nodes.
        const deleteBtn = event.target.closest('button[data-id]');
        if (deleteBtn) {
          FormHandler.handleDelete(event);
        }
      });
    }
  },
};

// =============================================================================
// === Application Startup ===
// =============================================================================

/**
 * Application startup sequence — runs once the DOM is fully parsed.
 *
 * Order:
 *  1. Load persisted transactions from Local Storage (handles unavailable /
 *     malformed storage gracefully via StorageService.load()).
 *  2. Initialise the Chart.js pie chart instance.
 *  3. Render the full UI (list, balance, chart) with the loaded data.
 *  4. Attach all event listeners so the app becomes interactive.
 *
 * Requirements: 3.3, 3.4, 3.5, 8.4
 */
document.addEventListener('DOMContentLoaded', function () {
  state.transactions = StorageService.load();
  ChartService.init();
  Renderer.renderAll(state.transactions);
  EventBootstrap.init();
});
