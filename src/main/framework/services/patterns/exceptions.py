"""Service-layer exceptions — unified minimal hierarchy.

The framework exposes a single, lean exception hierarchy for the service
layer. Every service-layer failure is expressed in terms of:

- :class:`ServiceError`: base class for all service-layer errors.
  Catch this in controllers / API handlers for generic 5xx mapping.
- :class:`NotFoundError`: raised when a requested entity does not exist
  in the repository. It is a subclass of :class:`ServiceError`, so an
  ``except ServiceError`` clause catches it too.

Historical context (PHASE 3 unification):
    A second parallel tree used to live in ``main.framework.core.exceptions``
    (``FrameworkException`` + five subclasses: ``JobNotFoundError``,
    ``AgentNotFoundError``, ``SessionError``, ``JobTimeoutError``,
    ``SchedulerError``). That module was dead code (zero call sites per
    the PHASE 2 audit) and was deleted. Callers that conceptually wanted
    a "job not found" or "agent not found" exception now use
    :class:`NotFoundError` with ``resource="job"`` or ``resource="agent"``
    (and an ``id=`` for the structured message form).
"""


class ServiceError(Exception):
    """Base exception for all service-layer errors.

    Catch this in controllers / API layer to handle service failures
    generically. Specific subclasses (e.g. :class:`NotFoundError`)
    carry the semantic meaning.
    """

    pass


class NotFoundError(ServiceError):
    """Raised when a requested entity does not exist in the repository.

    Preferred (structured) usage:

        raise NotFoundError("conversation", conv_id)
        # -> "conversation not found: id=abc-123"

        raise NotFoundError("job", job_id)
        # -> "job not found: id=42"

    The legacy single-message form is also accepted for backward
    compatibility with existing call sites:

        raise NotFoundError(f"Conversation {conv_id} not found")
        # -> "Conversation abc-123 not found" (used verbatim)
    """

    def __init__(self, resource: str = "resource", id: str | None = None) -> None:
        """Build a "not found" message.

        Args:
            resource: Name of the entity that was not found. When ``id``
                is also provided, the structured message is built as
                ``f"{resource} not found: id={id}"``. Otherwise it is
                ``f"{resource} not found"``.
            id: Optional identifier of the missing entity. When ``None``
                and ``resource`` itself already contains the literal
                ``"not found"``, the value is treated as a pre-formatted
                message and used verbatim (legacy call-site pattern).
        """
        if id is None and "not found" in resource:
            # Backward compat: a fully-formed message was passed.
            super().__init__(resource)
        elif id is not None:
            super().__init__(f"{resource} not found: id={id}")
        else:
            super().__init__(f"{resource} not found")
