"""Service layer exceptions — minimal hierarchy (1 base + 1 specialized)."""


class ServiceError(Exception):
    """Base exception for all service-layer errors.

    Catch this in controllers/API layer to handle service failures generically.
    Specific subclasses (e.g. NotFoundError) carry the semantic meaning.
    """

    pass


class NotFoundError(ServiceError):
    """Raised when a requested entity does not exist in the repository.

    Use this in service methods that look up entities by id/key, e.g.:
        conversation = self._repo.get(id)
        if conversation is None:
            raise NotFoundError(f"Conversation {id} not found")
    """

    pass
