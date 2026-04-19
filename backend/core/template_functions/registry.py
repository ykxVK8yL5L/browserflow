from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, Tuple


TemplateFn = Callable[[list[Any], Dict[str, Any]], Any]


class TemplateFunctionError(ValueError):
    pass


@dataclass(frozen=True)
class TemplateFunction:
    namespace: str
    name: str
    fn: TemplateFn
    description: str = ""
    signature: str = ""

    @property
    def full_name(self) -> str:
        return f"{self.namespace}.{self.name}"


class TemplateFunctionRegistry:
    """A small, safe registry for template-callable functions.

    - No eval.
    - Only whitelisted functions can be called.
    - Each function gets (args, ctx) where ctx currently includes {"outputs": outputs}.
    """

    def __init__(self) -> None:
        self._functions: Dict[Tuple[str, str], TemplateFunction] = {}

    def register(
        self,
        namespace: str,
        name: str,
        fn: TemplateFn,
        *,
        description: str = "",
        signature: str = "",
        overwrite: bool = False,
    ) -> None:
        key = (namespace, name)
        if not overwrite and key in self._functions:
            raise TemplateFunctionError(
                f"Template function already registered: {namespace}.{name}"
            )
        self._functions[key] = TemplateFunction(
            namespace=namespace,
            name=name,
            fn=fn,
            description=description,
            signature=signature,
        )

    def get(self, namespace: str, name: str) -> TemplateFunction | None:
        return self._functions.get((namespace, name))

    def call(
        self, namespace: str, name: str, args: list[Any], *, outputs: Dict[str, Any]
    ) -> Any:
        entry = self.get(namespace, name)
        if entry is None:
            return None
        return entry.fn(args, {"outputs": outputs})

    def list_functions(self) -> list[TemplateFunction]:
        return sorted(self._functions.values(), key=lambda f: f.full_name)
