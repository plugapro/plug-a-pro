# Customer WhatsApp street-address flow integrity

Status: implemented
Date: 2026-05-05

Decision:
Customer WhatsApp request flows must preserve active state after free-text address capture. Street address input must not fail silently, and generic greetings such as Hi must resume the active flow instead of resetting to the main menu.

Implementation notes:
- Street address is free text and is trimmed before being stored in the request draft conversation data.
- Ordinary addresses such as `21 Jump Street`, `Unit 4, 8 Oak Avenue`, and `22B Nelson Mandela Drive` are accepted without geocoding verification.
- The street-address step sends the next province selection prompt with timeout/error protection. If that outbound send fails, the user remains on the street-address step and receives a retry message instead of silence.
- Active multi-step WhatsApp flows override generic greeting/menu keywords. A customer who sends `Hi` during a service request receives a resume prompt with Continue, Cancel request, and Main menu actions.
- Conversation TTL is clamped to at least 30 minutes so an active customer request cannot expire after a two-minute pause.
- Geocoding or structured address resolution remains deferred until final request submission; failures there return the customer to address capture with a user-facing message.
