-- Otlobha Tuk-Tuk OSRM Routing Profile (tuktuk.lua)
-- Strictly avoids motorways, expressways, and trunks; caps max speed at 35 km/h.
api_version = 4
Set = require('lib/set')
Sequence = require('lib/sequence')
Handlers = require("lib/way_handlers")
find_access_tag = require("lib/access").find_access_tag

function setup()
  return {
    properties = {
      max_speed_for_map_matching = 45 / 3.6,
      weight_name = 'routability',
      process_call_tagless_node = false,
      u_turn_penalty = 10,
      continue_straight_at_waypoint = true,
      use_turn_restrictions = true,
    },
    default_mode = mode.driving,
    default_speed = 22,
    speeds = Sequence {
      highway = {
        -- Explicitly blocked high-speed roads (speed 0 = impassable)
        motorway = 0,
        motorway_link = 0,
        trunk = 0,
        trunk_link = 0,
        primary = 28,
        primary_link = 24,
        secondary = 32,
        secondary_link = 26,
        tertiary = 30,
        tertiary_link = 24,
        unclassified = 25,
        residential = 24,
        living_street = 16,
        service = 15,
      }
    },
    access_tag_whitelist = Set { 'yes', 'motor_vehicle', 'vehicle', 'permissive', 'designated' },
    access_tag_blacklist = Set { 'no', 'private', 'agricultural', 'forestry', 'emergency', 'psv', 'bus' },
  }
end

function process_way(profile, way, result, relations)
  local highway = way:get_value_by_key('highway')
  if not highway then return end
  if way:get_value_by_key('expressway') == 'yes' or highway == 'motorway' or highway == 'motorway_link' or highway == 'trunk' or highway == 'trunk_link' then
    return
  end
  local speed = profile.speeds.highway[highway]
  if not speed or speed <= 0 then return end
  result.forward_mode = mode.driving
  result.backward_mode = mode.driving
  result.forward_speed = math.min(speed, 35)
  result.backward_speed = math.min(speed, 35)
  if way:get_value_by_key('oneway') == 'yes' then
    result.backward_mode = mode.inaccessible
  end
end
