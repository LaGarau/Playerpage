if (marker) {
            newQrMarkerReferences[qr.id] = marker;

            // Attempt 2: If the marker is a Mapbox/Maplibre Marker object, try DOM manipulation
            // We use a short delay to ensure the marker is fully rendered in the DOM
            setTimeout(() => {
              try {
                // Check if the marker object exposes a getElement method (standard Mapbox/Maplibre Marker API)
                const el = marker.getElement ? marker.getElement() : null;

                if (el && el.nodeName === "DIV") {
                  // This applies the custom image as a background to the marker's container DIV
                  el.style.backgroundImage = `url(${QR_ICON_URL})`;

                  el.style.backgroundSize = "cover";

                  el.style.backgroundRepeat = "no-repeat";

                  // Set 60px size (as per previous implementation)
                  el.style.width = "55px";
                  el.style.height = "55px";

                  el.style.backgroundColor = "transparent"; // Hide the default background color

                  // Set circular shape and default black border
                  el.style.borderRadius = "50%";
                  // el.style.border = DEFAULT_BORDER_STYLE; // Use the default black border

                  el.innerHTML = ""; // Clear any inner SVG/content (like the default pin)

                  // Center the circle perfectly over the coordinate
                  el.style.transform = "translate(-50%, -50%)";

                  // NEW: Add click handler to the QR marker element
                  el.onclick = (e) => {
                    e.stopPropagation(); // Prevent map click events from firing
                    handleQrMarkerClick(qr);
                  };
                }
              } catch (domError) {
                console.warn(
                  `DOM manipulation failed for QR marker ${qr.id}`,
                  domError,
                );
              }
            }, 100);
          }
        } catch (e) {
          console.warn(`Skipped marker for ${qr.name}:`, e.message);
        }
      }
    }
    setQrMarkerReferences(newQrMarkerReferences);
  };