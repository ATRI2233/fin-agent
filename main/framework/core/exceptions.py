class FrameworkException(Exception):
    """Base exception for framework."""

    pass


class JobNotFoundError(FrameworkException):
    """Job not found in database."""

    pass


class AgentNotFoundError(FrameworkException):
    """Agent not registered."""

    pass


class HAPIConnectionError(FrameworkException):
    """Cannot connect to HAPI Hub."""

    pass


class JobTimeoutError(FrameworkException):
    """Job execution timed out."""

    pass


class SchedulerError(FrameworkException):
    """Scheduler error."""

    pass
