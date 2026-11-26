-- Otlobha Motorcycle OSRM Routing Profile (moto.lua)
-- Agile urban routing with lower turn penalties, narrower street access, and 80 km/h cap.
api_version = 4
Set = require('lib/set')
Sequence = require('lib/sequence')

function setup()
  return {
    properties = {
      max_speed_for_map_matching = 90 / 3.6,
      weight_name = 'routability',
      process_call_tagless_node = false,
      u_turn_penalty = 8,
      turn_penalty = 4.5,
      continue_straight_at_waypoint = true,
      use_turn_restrictions = true,
    },
    default_mode = mode.driving,
    default_speed = 38,
    speeds = Sequence {
      highway = {
        motorway = 80,
        motorway_link = 55,
        trunk = 70,
        trunk_link = 48,
        primary = 58,
        primary_link = 40,
        secondary = 50,
        secondary_link = 36,
        tertiary = 44,
        tertiary_link = 32,
        unclassified = 38,
        residential = 36,
        living_street = 24,
        service = 22,
      }
    },
  }
end

function process_way(profile, way, result, relations)
  local highway = way:get_value_by_key('highway')
  if not highway then return end
  if way:get_value_by_key('motorcycle') == 'no' then return end
  local speed = profile.speeds.highway[highway]
  if not speed or speed <= 0 then return end
  result.forward_mode = mode.driving
  result.backward_mode = mode.driving
  result.forward_speed = math.min(speed, 80)
  result.backward_speed = math.min(speed, 80)
  if way:get_value_by_key('oneway') == 'yes' then
    result.backward_mode = mode.inaccessible
  end
end
