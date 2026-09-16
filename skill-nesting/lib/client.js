window.__ModuleLoader__.load({
	id: "dsh-skill-nesting",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		//#region lib/types/client/card.module.css
		/**
		 * Card styles, injected once through a tagged style element with a
		 * querySelector guard — the convention every shipped ui-* plugin uses, so a
		 * reloaded bundle never stacks duplicate sheets.
		 */
		const CSS =
			".skn_card{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;list-style:none;transition:border-color .16s,background .16s}" +
			".skn_card:hover{border-color:var(--dsw-alias-label-dimmed)}" +
			".skn_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}" +
			".skn_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}" +
			".skn_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}" +
			".skn_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}" +
			".skn_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}" +
			".skn_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}" +
			".skn_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}" +
			".skn_chevronOpen{transform:rotate(180deg)}" +
			".skn_pending{flex:none;color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l4);border-radius:6px;padding:1px 6px;font-size:11px;line-height:1.6}" +
			".skn_body{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}" +
			".skn_readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}" +
			".skn_footer{border-top:.5px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}" +
			".skn_failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}" +
			".skn_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}" +
			".skn_field+.skn_field{border-top:.5px solid var(--dsw-alias-border-l2)}" +
			".skn_head{align-items:center;gap:8px;display:flex}" +
			".skn_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}" +
			".skn_badges{align-items:center;gap:8px;display:inline-flex}" +
			".skn_badge{color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l4);border-radius:6px;padding:1px 6px;font-size:11px;line-height:1.6}" +
			".skn_reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}" +
			".skn_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}" +
			".skn_reset:disabled{cursor:default}" +
			".skn_input{box-sizing:border-box;width:100%;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}" +
			".skn_input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}" +
			".skn_input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}" +
			".skn_inputInvalid{border-color:var(--dsw-alias-label-error)}" +
			".skn_textarea{height:auto;min-height:78px;resize:vertical;padding:8px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}" +
			".skn_invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}" +
			".skn_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}" +
			".skn_note{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:1.5;padding:0 0 4px}" +
			".skn_select{appearance:auto;cursor:pointer}" +
			".skn_checkRow{align-items:center;gap:8px;display:flex}" +
			".skn_checkbox{width:16px;height:16px;flex:none;margin:0;accent-color:var(--dsw-alias-brand-primary)}" +
			".skn_button{height:32px;font:inherit;font-size:13px;cursor:pointer;border-radius:8px;padding:0 14px;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}" +
			".skn_button:disabled{cursor:default;color:var(--dsw-alias-label-tertiary)}" +
			".skn_primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}" +
			".skn_primary:disabled{background:var(--dsw-alias-bg-layer-3);border-color:var(--dsw-alias-border-l4)}";

		const CSS_TAG_ID = "dsh-skill-nesting/SkillNestingCard.module.css";
		if (
			typeof document !== "undefined" &&
			document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG_ID) + "]") === null
		) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-skill-nesting";
			tag.dataset.pluginCss = CSS_TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region lib/types/client/locales.js
		/** Dictionary namespace owned by this plugin. */
		const NS = "skill-nesting";

		/** English copy. */
		const en = {
			title: "Skill nesting",
			description: "Recursive, multi-root skill discovery.",
			intro:
				"The built-in provider reads each root one level deep, so skills organised as <root>/<category>/<skill>/SKILL.md stay invisible. This provider walks each root to the configured depth and adds those skills to the same catalog.",
			expand: "Expand settings",
			collapse: "Collapse settings",
			unsaved: "Unsaved",
			readOnly: "This deployment's settings are read-only.",
			save: "Save",
			saving: "Saving…",
			discard: "Discard changes",
			saveFailed: "This deployment did not accept these values; your edits are kept.",
			overridden: "Overridden",
			reset: "Reset",
			roots: "Skill roots",
			rootsHint: "Absolute paths, one per line. A root may also hold flat <root>/*.md skills.",
			providerName: "Provider name",
			providerNameHint: "Name this provider registers in the skills registry.",
			maxDepth: "Max depth",
			maxDepthHint: "Category levels to descend below each root.",
			rank: "Rank",
			rankHint: "Precedence within its layer; lower wins. The built-in roots use 400/500.",
			watch: "Watch for changes",
			watchHint: "Recursively watch each root and refresh the catalog on edits.",
			watchDebounceMs: "Watch debounce (ms)",
			watchDebounceMsHint: "Delay before a filesystem change refreshes the catalog.",
			includeHidden: "Include hidden directories",
			includeHiddenHint: "Descend into dot-directories such as .archive or .system.",
			includeFlatRootFiles: "Include flat root files",
			includeFlatRootFilesHint: "Also read skills written directly as <root>/*.md.",
			duplicatePolicy: "Duplicate policy",
			duplicatePolicyHint: "How one skill name provided by several distinct files is resolved.",
			policyFirstWins: "First wins — keep the first root's file",
			policyError: "Error — withhold the name entirely",
			policyFirstWinsNote:
				"With “First wins”, the first root supplying a name keeps it. Roots that are the same directory (a symlink alias, or a mirrored tree) are recognised by file identity and never count as duplicates.",
			policyErrorNote:
				"With “Error”, a name claimed by two distinct files is withheld entirely, so a caller can never act on the wrong instructions.",
			duplicatePolicyRequired: "Choose a duplicate policy.",
			providerNameRequired: "Enter a provider name.",
			invalidNumber: "Enter a number.",
			invalidDepth: "Enter a whole number from 1 to 12.",
			invalidDebounce: "Enter a whole number of at least 50.",
		};

		/** Simplified Chinese copy. */
		const zh = {
			title: "分层技能发现",
			description: "递归、多根目录的技能发现。",
			intro:
				"内置 provider 每个根目录只读一层，因此 <root>/<分类>/<技能>/SKILL.md 这种布局的技能完全看不到。本 provider 会按配置深度逐层遍历，把这些技能补进同一个目录。",
			expand: "展开设置",
			collapse: "收起设置",
			unsaved: "未保存",
			readOnly: "本部署的设置为只读。",
			save: "保存",
			saving: "保存中…",
			discard: "放弃修改",
			saveFailed: "本部署没有接受这些值，已保留供你修改。",
			overridden: "已覆盖",
			reset: "恢复默认",
			roots: "技能根目录",
			rootsHint: "绝对路径，每行一个。根目录下也可以直接放 <root>/*.md 形式的技能。",
			providerName: "Provider 名称",
			providerNameHint: "该 provider 在技能注册表中注册的名字。",
			maxDepth: "最大深度",
			maxDepthHint: "在每个根目录下向里遍历的分类层数。",
			rank: "优先级",
			rankHint: "同一层内的优先级，数值小者胜出。内置根目录为 400/500。",
			watch: "监听文件变化",
			watchHint: "递归监听各根目录，文件改动后自动刷新技能目录。",
			watchDebounceMs: "监听防抖（毫秒）",
			watchDebounceMsHint: "文件变化后延迟多久刷新技能目录。",
			includeHidden: "包含隐藏目录",
			includeHiddenHint: "是否进入 .archive、.system 这类点号开头的目录。",
			includeFlatRootFiles: "包含根目录下的散装技能",
			includeFlatRootFilesHint: "同时读取直接写成 <root>/*.md 的技能。",
			duplicatePolicy: "重名处理",
			duplicatePolicyHint: "同一个技能名出现在多个不同文件时如何处理。",
			policyFirstWins: "先到先得——保留第一个根目录的文件",
			policyError: "报错——该名字整个撤下",
			policyFirstWinsNote:
				"选择「先到先得」时，先提供该名字的根目录胜出。指向同一目录的多个根（符号链接别名、镜像目录）按文件身份识别，永远不会被算作重名。",
			policyErrorNote:
				"选择「报错」时，被两个不同文件抢用的名字会整个从目录中撤下，调用方绝不会读到错的那份。",
			duplicatePolicyRequired: "请选择一种重名处理方式。",
			providerNameRequired: "请填写 provider 名称。",
			invalidNumber: "请填数字。",
			invalidDepth: "请填 1 到 12 之间的整数。",
			invalidDebounce: "请填不小于 50 的整数。",
		};
		//#endregion

		//#region lib/types/client/fields.js
		/** Chevron affordance for the card header. */
		function Chevron(props) {
			return react.createElement(
				"svg",
				{
					className: props.open ? "skn_chevron skn_chevronOpen" : "skn_chevron",
					width: 14,
					height: 14,
					viewBox: "0 0 16 16",
					fill: "none",
					"aria-hidden": "true",
				},
				react.createElement("path", {
					d: "M4 6.5 8 10.5l4-4",
					stroke: "currentColor",
					strokeWidth: 1.5,
					strokeLinecap: "round",
					strokeLinejoin: "round",
				}),
			);
		}

		/**
		 * One labelled control row: label, optional “overridden” badge with its reset
		 * affordance, the control itself, and a hint that becomes the validation
		 * message while the draft is invalid.
		 */
		function Field(props) {
			return react.createElement(
				"div",
				{ className: "skn_field" },
				react.createElement(
					"div",
					{ className: "skn_head" },
					react.createElement("label", { className: "skn_label", htmlFor: props.id }, props.label),
					props.overridden
						? react.createElement(
								"span",
								{ className: "skn_badges" },
								react.createElement("span", { className: "skn_badge" }, props.overriddenLabel),
								react.createElement(
									"button",
									{ type: "button", className: "skn_reset", disabled: props.disabled, onClick: props.onReset },
									props.resetLabel,
								),
							)
						: null,
				),
				props.control,
				react.createElement(
					"p",
					{ className: props.invalid ? "skn_invalid" : "skn_hint" },
					props.invalid ? props.invalidLabel : props.hint,
				),
			);
		}
		//#endregion

		//#region lib/types/client/form.js
		const NUMBER_FIELDS = [
			{ key: "maxDepth", labelKey: "maxDepth", hintKey: "maxDepthHint", invalidKey: "invalidDepth", min: 1, max: 12 },
			{ key: "rank", labelKey: "rank", hintKey: "rankHint", invalidKey: "invalidNumber" },
			{ key: "watchDebounceMs", labelKey: "watchDebounceMs", hintKey: "watchDebounceMsHint", invalidKey: "invalidDebounce", min: 50 },
		];
		const BOOLEAN_FIELDS = [
			{ key: "watch", labelKey: "watch", hintKey: "watchHint" },
			{ key: "includeHidden", labelKey: "includeHidden", hintKey: "includeHiddenHint" },
			{ key: "includeFlatRootFiles", labelKey: "includeFlatRootFiles", hintKey: "includeFlatRootFilesHint" },
		];
		const POLICY_KEY = "duplicatePolicy";
		const POLICY_OPTIONS = [
			{ value: "first-wins", labelKey: "policyFirstWins" },
			{ value: "error", labelKey: "policyError" },
		];
		const PROVIDER_KEY = "providerName";
		const SECTION_KEYS = [
			"roots",
			POLICY_KEY,
			PROVIDER_KEY,
			...NUMBER_FIELDS.map((field) => field.key),
			...BOOLEAN_FIELDS.map((field) => field.key),
		];
		const BOOLEAN_KEYS = new Set(BOOLEAN_FIELDS.map((field) => field.key));

		/** `roots` accepts an array or one string; normalise either to textarea lines. */
		function rootsToText(roots) {
			if (Array.isArray(roots)) return roots.join("\n");
			if (typeof roots === "string") {
				return roots.split(/[\n,]/).map((part) => part.trim()).filter(Boolean).join("\n");
			}
			return "";
		}

		/** Textarea text to the array the namespace stores. */
		function textToRoots(text) {
			if (typeof text !== "string") return [];
			return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
		}

		/** Every section value with `roots` normalised, so comparison is stable. */
		function normaliseSection(value) {
			return { ...value, roots: textToRoots(rootsToText(value.roots)) };
		}

		/** Structural comparison; these values are small and plain. */
		function same(left, right) {
			return JSON.stringify(left) === JSON.stringify(right);
		}

		/** Parse one numeric control; undefined when the text is not acceptable. */
		function parseNumber(spec, text) {
			const trimmed = String(text).trim();
			if (trimmed === "") return undefined;
			const parsed = Number(trimmed);
			if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return undefined;
			if (spec.min !== undefined && parsed < spec.min) return undefined;
			if (spec.max !== undefined && parsed > spec.max) return undefined;
			return parsed;
		}

		/** Minimal snapshot store, the read shape a card's selector expects. */
		function createStore(initial) {
			let current = initial;
			const listeners = new Set();
			return {
				getSnapshot: () => current,
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				set(next) {
					current = next;
					for (const listener of listeners) listener();
				},
			};
		}

		/**
		 * Staged edits over one bound settings scope.
		 *
		 * A draft is text, because that is what the control holds; `plan()` converts
		 * drafts into the atomic op list a save sends. Only fields whose draft
		 * differs from the resolved value produce an op, so a value the user never
		 * touched cannot be cleared by a save.
		 */
		class CardForm {
			constructor(scope) {
				this.scope = scope;
				/** key -> { text, clear } for edited fields only. */
				this.staged = new Map();
				this.listeners = new Set();
				this.saving = false;
				this.failed = false;
				this.disposed = false;
				this.unsubscribe = scope.subscribe(() => this.publish());
			}

			/**
			 * Stop publishing once the owning fiber unwinds.
			 *
			 * The scope's own subscription belongs to the scope, but this form must
			 * not keep pushing into a card that no longer exists.
			 */
			dispose() {
				if (this.disposed) return;
				this.disposed = true;
				this.unsubscribe?.();
				this.unsubscribe = undefined;
				this.listeners.clear();
			}

			/** Build the store a card reads through its bound selector. */
			bind(project) {
				const store = createStore(project());
				this.listeners.add(() => store.set(project()));
				return store;
			}

			publish() {
				if (this.disposed) return;
				for (const listener of this.listeners) listener();
			}

			/** The resolved section, normalised, or undefined while unavailable. */
			section() {
				const snapshot = this.scope.getSnapshot();
				return snapshot.value === undefined ? undefined : normaliseSection(snapshot.value);
			}

			/** The raw user layer, which is what “overridden” is read from. */
			user() {
				return this.scope.getSnapshot().user;
			}

			/** Card-level state every control shares. */
			shell() {
				const snapshot = this.scope.getSnapshot();
				const plan = this.plan();
				return {
					available: snapshot.status === "ready",
					writable: snapshot.writable === true,
					dirty: plan !== undefined && plan.length > 0,
					invalid: plan === undefined,
					saving: this.saving,
					failed: this.failed,
				};
			}

			/** The text one control shows. */
			text(key) {
				const staged = this.staged.get(key);
				if (staged !== undefined) return staged.text;
				const section = this.section();
				if (section === undefined) return "";
				if (key === "roots") return rootsToText(section.roots);
				const value = section[key];
				return value === undefined || value === null ? "" : String(value);
			}

			/** Whether this field currently carries a user override. */
			overridden(key) {
				const staged = this.staged.get(key);
				if (staged !== undefined) return staged.clear !== true;
				const user = this.user();
				return user !== undefined && user !== null && Object.hasOwn(user, key);
			}

			/** Validation message key for one field, or undefined while it is valid. */
			invalid(key) {
				const staged = this.staged.get(key);
				if (staged === undefined || staged.clear === true) return undefined;
				if (key === "roots") return undefined;
				if (key === PROVIDER_KEY) return staged.text.trim() === "" ? "providerNameRequired" : undefined;
				if (key === POLICY_KEY) {
					return POLICY_OPTIONS.some((option) => option.value === staged.text) ? undefined : "duplicatePolicyRequired";
				}
				const spec = NUMBER_FIELDS.find((field) => field.key === key);
				if (spec === undefined) return undefined;
				return parseNumber(spec, staged.text) === undefined ? spec.invalidKey : undefined;
			}

			/**
			 * The atomic op list this form would write, or undefined when any draft is
			 * invalid. An empty array means “nothing to do”.
			 */
			plan() {
				const section = this.section();
				const ops = [];
				for (const key of SECTION_KEYS) {
					const staged = this.staged.get(key);
					if (staged === undefined) continue;
					if (staged.clear === true) {
						if (section !== undefined) ops.push({ op: "unset", path: [key] });
						continue;
					}
					let value;
					if (key === "roots") {
						value = textToRoots(staged.text);
					} else if (key === PROVIDER_KEY) {
						if (staged.text.trim() === "") return undefined;
						value = staged.text.trim();
					} else if (key === POLICY_KEY) {
						if (!POLICY_OPTIONS.some((option) => option.value === staged.text)) return undefined;
						value = staged.text;
					} else if (BOOLEAN_KEYS.has(key)) {
						value = staged.text === "true";
					} else {
						const spec = NUMBER_FIELDS.find((field) => field.key === key);
						value = parseNumber(spec, staged.text);
						if (value === undefined) return undefined;
					}
					if (section !== undefined && same(value, section[key])) continue;
					ops.push({ op: "set", path: [key], value });
				}
				return ops;
			}

			/** Bind the edit, reset, save, and discard actions to this form. */
			actions() {
				return {
					edit: (key, text) => {
						this.failed = false;
						this.staged.set(key, { text, clear: false });
						this.publish();
					},
					resetField: (key) => {
						this.failed = false;
						this.staged.set(key, { text: "", clear: true });
						this.publish();
					},
					save: () => this.save(),
					discard: () => {
						if (this.staged.size === 0 && !this.failed) return;
						this.staged.clear();
						this.failed = false;
						this.publish();
					},
				};
			}

			/** Write every staged edit as one revision-fenced mutation. */
			async save() {
				const plan = this.plan();
				if (plan === undefined || plan.length === 0) return;
				this.saving = true;
				this.failed = false;
				this.publish();
				try {
					await this.scope.mutate(plan);
					this.staged.clear();
				} catch {
					this.failed = true;
				} finally {
					this.saving = false;
					this.publish();
				}
			}
		}
		//#endregion

		//#region lib/types/client/SkillNestingCard.js
		/**
		 * One plugin's card: a header naming the plugin and what its settings govern,
		 * disclosing the controls in place, with the save that writes them.
		 *
		 * The card owns its chrome and returns an `<li>`, because the Plugins page
		 * renders every card into a `<ul>` and supplies nothing but the slot.
		 */
		function SkillNestingCard(props) {
			const { t, form, store } = props;
			const snapshot = react.useSyncExternalStore(
				react.useCallback((listener) => store.subscribe(listener), [store]),
				react.useCallback(() => store.getSnapshot(), [store]),
				react.useCallback(() => store.getSnapshot(), [store]),
			);
			const [open, setOpen] = react.useState(false);
			const saveStarted = react.useRef(false);

			// Collapse once a save settles cleanly, matching every shipped card.
			react.useEffect(() => {
				if (snapshot.saving) {
					saveStarted.current = true;
					return;
				}
				if (!saveStarted.current) return;
				saveStarted.current = false;
				if (!snapshot.dirty && !snapshot.failed) setOpen(false);
			}, [snapshot.dirty, snapshot.failed, snapshot.saving]);

			// A namespace this Host does not serve renders nothing at all, so an
			// uncomposed plugin leaves no trace on the page.
			if (!snapshot.available) return null;

			const disabled = !snapshot.writable || snapshot.saving;
			const actions = form.actions();

			const fieldProps = (key, labelKey, hintKey) => {
				const invalid = form.invalid(key);
				return {
					id: "skill-nesting-" + key,
					label: t(labelKey),
					hint: t(hintKey),
					disabled,
					overridden: form.overridden(key),
					overriddenLabel: t("overridden"),
					resetLabel: t("reset"),
					onReset: () => actions.resetField(key),
					invalid: invalid !== undefined,
					invalidLabel: invalid === undefined ? "" : t(invalid),
				};
			};

			const numberControl = (spec) => {
				const invalid = form.invalid(spec.key);
				return react.createElement("input", {
					id: "skill-nesting-" + spec.key,
					className: invalid !== undefined ? "skn_input skn_inputInvalid" : "skn_input",
					type: "text",
					inputMode: "numeric",
					value: form.text(spec.key),
					disabled,
					"aria-invalid": invalid !== undefined ? true : undefined,
					onChange: (event) => actions.edit(spec.key, event.target.value),
				});
			};

			return react.createElement(
				"li",
				{ className: open ? "skn_card skn_cardOpen" : "skn_card" },
				react.createElement(
					"button",
					{
						type: "button",
						className: "skn_header",
						"aria-expanded": open,
						"aria-label": t(open ? "collapse" : "expand") + ": " + t("title"),
						onClick: () => setOpen(!open),
					},
					react.createElement(
						"span",
						{ className: "skn_headText" },
						react.createElement("span", { className: "skn_name" }, t("title")),
						react.createElement("span", { className: "skn_description" }, t("description")),
					),
					snapshot.dirty ? react.createElement("span", { className: "skn_pending" }, t("unsaved")) : null,
					react.createElement(Chevron, { open: open }),
				),
				open
					? react.createElement(
							"div",
							{ className: "skn_body" },
							!snapshot.writable
								? react.createElement("p", { className: "skn_readOnly", role: "status" }, t("readOnly"))
								: null,
							react.createElement("p", { className: "skn_note" }, t("intro")),

							react.createElement(Field, {
								...fieldProps("roots", "roots", "rootsHint"),
								control: react.createElement("textarea", {
									id: "skill-nesting-roots",
									className: "skn_input skn_textarea",
									value: form.text("roots"),
									disabled,
									spellCheck: false,
									onChange: (event) => actions.edit("roots", event.target.value),
								}),
							}),

							react.createElement(Field, {
								...fieldProps(POLICY_KEY, "duplicatePolicy", "duplicatePolicyHint"),
								control: react.createElement(
									"select",
									{
										id: "skill-nesting-duplicatePolicy",
										className: "skn_input skn_select",
										value: form.text(POLICY_KEY),
										disabled,
										onChange: (event) => actions.edit(POLICY_KEY, event.target.value),
									},
									POLICY_OPTIONS.map((option) =>
										react.createElement("option", { key: option.value, value: option.value }, t(option.labelKey)),
									),
								),
							}),
							react.createElement(
								"p",
								{ className: "skn_note" },
								form.text(POLICY_KEY) === "error" ? t("policyErrorNote") : t("policyFirstWinsNote"),
							),

							react.createElement(Field, {
								...fieldProps(PROVIDER_KEY, "providerName", "providerNameHint"),
								control: react.createElement("input", {
									id: "skill-nesting-providerName",
									className:
										form.invalid(PROVIDER_KEY) !== undefined ? "skn_input skn_inputInvalid" : "skn_input",
									type: "text",
									value: form.text(PROVIDER_KEY),
									disabled,
									"aria-invalid": form.invalid(PROVIDER_KEY) !== undefined ? true : undefined,
									onChange: (event) => actions.edit(PROVIDER_KEY, event.target.value),
								}),
							}),

							NUMBER_FIELDS.map((spec) =>
								react.createElement(Field, {
									key: spec.key,
									...fieldProps(spec.key, spec.labelKey, spec.hintKey),
									control: numberControl(spec),
								}),
							),

							BOOLEAN_FIELDS.map((field) =>
								react.createElement(Field, {
									key: field.key,
									...fieldProps(field.key, field.labelKey, field.hintKey),
									control: react.createElement(
										"span",
										{ className: "skn_checkRow" },
										react.createElement("input", {
											id: "skill-nesting-" + field.key,
											className: "skn_checkbox",
											type: "checkbox",
											checked: form.text(field.key) === "true",
											disabled,
											onChange: (event) => actions.edit(field.key, event.target.checked ? "true" : "false"),
										}),
									),
								}),
							),

							react.createElement(
								"div",
								{ className: "skn_footer" },
								snapshot.failed
									? react.createElement("p", { className: "skn_failed", role: "status" }, t("saveFailed"))
									: null,
								react.createElement(
									"button",
									{
										type: "button",
										className: "skn_button",
										disabled: !snapshot.dirty || snapshot.saving,
										onClick: () => actions.discard(),
									},
									t("discard"),
								),
								react.createElement(
									"button",
									{
										type: "button",
										className: "skn_button skn_primary",
										disabled: !snapshot.writable || !snapshot.dirty || snapshot.invalid || snapshot.saving,
										onClick: () => actions.save(),
									},
									t(snapshot.saving ? "saving" : "save"),
								),
							),
						)
					: null,
			);
		}
		//#endregion

		const inject = ["slots", "locale", "settingsScope"];

		/**
		 * Register this plugin's dictionaries and claim its card cell.
		 *
		 * The card key is the settings namespace: the Plugins page enumerates every
		 * namespace the Host serves and dispatches exactly that key, so a served
		 * namespace with no card renders nothing, and a card whose namespace the Host
		 * does not serve is never dispatched.
		 */
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "skill-nesting: dictionaries");

			const form = new CardForm(ctx.settingsScope.bind({ namespace: NS }));
			const store = form.bind(() => form.shell());
			// The form owns its store; its scope subscription is disposed with the
			// scope itself, so this effect only stops the store from publishing into a
			// torn-down card.
			ctx.effect(
				() => () => form.dispose(),
				"skill-nesting: card store",
			);

			ctx.slots.inject("settings.plugin.item", () =>
				ctx.slots.register({ name: "settings.plugin.item", key: NS, locale: NS }, (props) =>
					react.createElement(SkillNestingCard, { t: props.t ?? t, form, store }),
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});