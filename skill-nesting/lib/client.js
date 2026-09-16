window.__ModuleLoader__.load({
	id: "dsh-skill-nesting",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		//#region lib/types/client/card.js
		/**
		 * Skill-nesting settings card.
		 *
		 * Rendered inside Settings → Plugins, in the "configurable" tab this
		 * namespace is auto-dispatched into: `ui-settings-plugins` enumerates every
		 * registered Host settings namespace and renders one `settings.plugin.item`
		 * keyed by the namespace, so the only thing this half must do is claim its
		 * own key.
		 *
		 * Everything is staged locally and written on Apply. The scope's `mutate`
		 * receives one atomic op list built by diffing the draft against the
		 * resolved value, so untouched fields are never restated — a field the user
		 * did not see can never be cleared by a save.
		 */
		const NAMESPACE = "skill-nesting";

		/** Field descriptors drive both the form and the diff, so they cannot drift. */
		const NUMBER_FIELDS = [
			{ key: "maxDepth", label: "Max depth", hint: "Category levels to descend below each root.", min: 1, max: 12 },
			{ key: "rank", label: "Rank", hint: "Precedence within its layer; lower wins. Built-in roots use 400/500.", min: 0 },
			{ key: "watchDebounceMs", label: "Watch debounce (ms)", hint: "Delay before a filesystem change refreshes the catalog.", min: 50 },
		];
		const BOOLEAN_FIELDS = [
			{ key: "watch", label: "Watch for changes", hint: "Recursively watch each root and refresh the catalog on edits." },
			{ key: "includeHidden", label: "Include hidden directories", hint: "Descend into dot-directories such as .archive or .system." },
			{ key: "includeFlatRootFiles", label: "Include flat root files", hint: "Also read skills written directly as <root>/*.md." },
		];
		const POLICY_FIELD = { key: "duplicatePolicy", label: "Duplicate policy", hint: "How one skill name provided by several distinct files is resolved." };
		const POLICY_OPTIONS = [
			{ value: "first-wins", label: "First wins — keep the first root's file" },
			{ value: "error", label: "Error — withhold the name entirely" },
		];
		const ALL_KEYS = [
			"providerName",
			"roots",
			POLICY_FIELD.key,
			...NUMBER_FIELDS.map((field) => field.key),
			...BOOLEAN_FIELDS.map((field) => field.key),
		];

		/** Structural JSON comparison; these settings values are small and plain. */
		function sameValue(left, right) {
			return JSON.stringify(left) === JSON.stringify(right);
		}

		/** `roots` accepts an array or a single string; normalise either to lines. */
		function rootsToText(roots) {
			if (Array.isArray(roots)) return roots.join("\n");
			if (typeof roots === "string") return roots.split(/[\n,]/).map((part) => part.trim()).filter(Boolean).join("\n");
			return "";
		}

		/** Split the textarea into an array of root paths, dropping blanks. */
		function parseRootLines(text) {
			if (typeof text !== "string") return [];
			return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
		}

		/**
		 * Build the baseline the draft is compared against.
		 * `roots` is normalised to an array so a composition row that spelled it as
		 * one string does not read as a permanent pending edit.
		 */
		function baselineOf(value) {
			return { ...value, roots: parseRootLines(rootsToText(value.roots)) };
		}

		/**
		 * The atomic op list moving `baseline` to `draft`.
		 * A field equal to the baseline issues no op at all, so an untouched field
		 * is never restated — and can never be cleared by a save.
		 */
		function diffOps(baseline, draft) {
			const ops = [];
			for (const key of ALL_KEYS) {
				if (draft[key] === undefined) continue;
				if (sameValue(draft[key], baseline[key])) continue;
				ops.push({ op: "set", path: [key], value: draft[key] });
			}
			return ops;
		}

		/** Draft shape: the resolved value plus the textarea's own text field. */
		function draftOf(value) {
			const baseline = baselineOf(value);
			return { ...baseline, rootsText: rootsToText(value.roots) };
		}

		/** Strip the local-only text field and normalise roots before diffing. */
		function committedOf(draft) {
			const next = { ...draft };
			next.roots = parseRootLines(draft.rootsText);
			delete next.rootsText;
			return next;
		}

		const S = {
			section: { display: "flex", flexDirection: "column", gap: "10px", maxWidth: "720px", color: "var(--dsw-alias-label-primary)" },
			heading: { margin: 0, fontSize: "18px", fontWeight: 600 },
			intro: { margin: 0, fontSize: "13px", lineHeight: 1.6, color: "var(--dsw-alias-label-tertiary)" },
			field: { display: "flex", flexDirection: "column", gap: "6px", padding: "12px 0", borderTop: "0.5px solid var(--dsw-alias-border-l2)" },
			row: { display: "flex", alignItems: "center", gap: "10px" },
			label: { flex: 1, fontSize: "13px", fontWeight: 500, lineHeight: 1.5 },
			hint: { margin: 0, fontSize: "12px", lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary)" },
			input: {
				boxSizing: "border-box", width: "100%", padding: "6px 9px", font: "inherit", fontSize: "13px",
				color: "var(--dsw-alias-label-primary)", background: "var(--dsw-alias-bg-layer-3)",
				border: "0.5px solid var(--dsw-alias-border-l4)", borderRadius: "6px",
			},
			narrow: { width: "150px", flex: "none" },
			wide: { width: "280px", flex: "none" },
			textarea: { minHeight: "84px", resize: "vertical", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
			actions: { display: "flex", alignItems: "center", gap: "10px", paddingTop: "4px", flexWrap: "wrap" },
			button: {
				padding: "6px 14px", font: "inherit", fontSize: "13px", cursor: "pointer", borderRadius: "6px",
				border: "0.5px solid var(--dsw-alias-border-l4)", background: "var(--dsw-alias-bg-layer-3)",
				color: "var(--dsw-alias-label-primary)",
			},
			primary: { background: "var(--dsw-alias-label-primary)", color: "var(--dsw-alias-bg-layer-1)" },
			note: { margin: 0, fontSize: "12px", lineHeight: 1.6, color: "var(--dsw-alias-label-secondary)" },
			error: { margin: 0, fontSize: "12px", lineHeight: 1.6, color: "#d95c5c" },
			ok: { margin: 0, fontSize: "12px", lineHeight: 1.6, color: "var(--dsw-alias-label-tertiary)" },
		};

		/** One labelled field wrapper. */
		function Field(props) {
			return react.createElement(
				"div",
				{ style: S.field },
				react.createElement("div", { style: S.row }, react.createElement("span", { style: S.label }, props.label), props.control),
				props.hint !== undefined ? react.createElement("p", { style: S.hint }, props.hint) : null,
			);
		}

		/**
		 * The settings card.
		 *
		 * `useSyncExternalStore` over the bound scope is the whole data layer: the
		 * scope derives from the shared settings mirror, so a document commit or a
		 * reconnect refreshes this component without a wire read of its own.
		 */
		function SkillNestingCard(props) {
			const scope = props.scope;
			const subscribe = react.useMemo(() => (listener) => scope.subscribe(listener), [scope]);
			const read = react.useMemo(() => () => scope.getSnapshot(), [scope]);
			const snapshot = react.useSyncExternalStore(subscribe, read, read);

			const value = snapshot.value;
			const revision = snapshot.revision;
			const [edits, setEdits] = react.useState(undefined);
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState(undefined);
			const [saved, setSaved] = react.useState(false);

			// Re-seed whenever the Host documents a new revision, so a write from
			// another surface is reflected rather than overwritten on next save.
			react.useEffect(() => {
				setEdits(undefined);
				setSaved(false);
				setError(undefined);
			}, [revision, value === undefined]);

			if (snapshot.status === "loading") return react.createElement("p", { style: S.ok }, "Loading settings…");

			if (value === undefined) {
				return react.createElement(
					"div",
					{ style: S.section },
					react.createElement("h2", { style: S.heading }, "Skill nesting"),
					react.createElement("p", { style: S.note }, "The Host serves no skill-nesting settings namespace, so these values come from the composition row alone."),
				);
			}

			// The draft always exists when a value does: local edits layer over a
			// freshly derived baseline, so the first render is never undefined.
			const baseline = baselineOf(value);
			const draft = edits === undefined ? draftOf(value) : edits;
			const writable = snapshot.writable === true;

			const set = (key, next) => {
				setSaved(false);
				setEdits({ ...draft, [key]: next });
			};

			const pending = diffOps(baseline, committedOf(draft));

			const apply = async () => {
				if (!writable || pending.length === 0) return;
				setBusy(true);
				setError(undefined);
				try {
					await scope.mutate(pending);
					setSaved(true);
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setBusy(false);
				}
			};

			const revert = () => {
				setError(undefined);
				setSaved(false);
				setEdits(undefined);
			};

			return react.createElement(
				"div",
				{ style: S.section },
				react.createElement("h2", { style: S.heading }, "Skill nesting"),
				react.createElement(
					"p",
					{ style: S.intro },
					"Recursive, multi-root skill discovery. The built-in provider reads each root one level deep, so skills organised as <root>/<category>/<skill>/SKILL.md stay invisible to it. This provider walks each root to the configured depth and adds those skills to the same catalog.",
				),

				react.createElement(
					"div",
					{ style: S.field },
					react.createElement("span", { style: S.label }, "Skill roots"),
					react.createElement("textarea", {
						style: { ...S.input, ...S.textarea },
						value: draft.rootsText,
						disabled: !writable,
						onChange: (event) => set("rootsText", event.target.value),
						spellCheck: false,
					}),
					react.createElement("p", { style: S.hint }, "Absolute paths, one per line. A root may also hold flat <root>/*.md skills."),
				),

				react.createElement(Field, {
					label: POLICY_FIELD.label,
					hint: POLICY_FIELD.hint,
					control: react.createElement(
						"select",
						{
							style: { ...S.input, ...S.wide },
							value: draft.duplicatePolicy,
							disabled: !writable,
							onChange: (event) => set("duplicatePolicy", event.target.value),
						},
						POLICY_OPTIONS.map((option) => react.createElement("option", { key: option.value, value: option.value }, option.label)),
					),
				}),
				react.createElement(
					"p",
					{ style: S.note },
					draft.duplicatePolicy === "error"
						? "With “Error”, a name claimed by two distinct files is withheld entirely, so a caller can never act on the wrong instructions."
						: "With “First wins”, the first root supplying a name keeps it. Roots that are the same directory (a symlink alias, or a mirrored tree) are recognised by file identity and never count as duplicates.",
				),

				NUMBER_FIELDS.map((field) =>
					react.createElement(Field, {
						key: field.key,
						label: field.label,
						hint: field.hint,
						control: react.createElement("input", {
							type: "number",
							style: { ...S.input, ...S.narrow },
							value: String(draft[field.key]),
							min: field.min,
							max: field.max,
							disabled: !writable,
							onChange: (event) => {
								const parsed = Number(event.target.value);
								if (Number.isFinite(parsed)) set(field.key, parsed);
							},
						}),
					}),
				),

				react.createElement(Field, {
					label: "Provider name",
					hint: "Name this provider registers in the skills registry.",
					control: react.createElement("input", {
						type: "text",
						style: { ...S.input, ...S.wide },
						value: String(draft.providerName),
						disabled: !writable,
						onChange: (event) => set("providerName", event.target.value),
					}),
				}),

				BOOLEAN_FIELDS.map((field) =>
					react.createElement(Field, {
						key: field.key,
						label: field.label,
						hint: field.hint,
						control: react.createElement("input", {
							type: "checkbox",
							checked: draft[field.key] === true,
							disabled: !writable,
							style: { width: "16px", height: "16px", flex: "none" },
							onChange: (event) => set(field.key, event.target.checked),
						}),
					}),
				),

				react.createElement(
					"div",
					{ style: S.actions },
					react.createElement(
						"button",
						{ type: "button", style: { ...S.button, ...S.primary }, disabled: !writable || busy || pending.length === 0, onClick: apply },
						busy ? "Saving…" : "Apply",
					),
					react.createElement("button", { type: "button", style: S.button, disabled: !writable || busy || pending.length === 0, onClick: revert }, "Revert"),
					error !== undefined ? react.createElement("p", { style: S.error }, error) : null,
					error === undefined && saved && pending.length === 0 ? react.createElement("p", { style: S.ok }, "Saved.") : null,
				),
			);
		}
		//#endregion

		const inject = ["slots", "settingsScope"];

		/**
		 * Claim this plugin's cell in the Plugins settings page.
		 *
		 * The card key is the settings namespace. The tab enumerates registered
		 * Host namespaces and dispatches exactly that key, so a served namespace with
		 * no card renders nothing, and a card whose namespace the Host does not
		 * serve is never dispatched.
		 */
		function apply(ctx) {
			const scope = ctx.settingsScope.bind({ namespace: NAMESPACE });
			ctx.slots.inject("settings.plugin.item", () =>
				ctx.slots.register({ name: "settings.plugin.item", key: NAMESPACE }, (props) =>
					react.createElement(SkillNestingCard, { scope, t: props.t }),
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});