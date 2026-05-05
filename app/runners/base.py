"""Abstract runner contract."""

from abc import ABC, abstractmethod


class BaseRunner(ABC):
    """Shared lifecycle for stream execution backends."""

    @abstractmethod
    def run(self, stream_id: int) -> None:
        """Execute one logical cycle for the stream."""

        raise NotImplementedError
